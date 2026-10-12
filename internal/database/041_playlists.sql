-- User playlists: an ordered list of songs with one category, whose genre the
-- game uses to draw the playlist's folder, and an optional cover stored like a
-- song cover together with a small JPEG of it for the game, which cannot
-- decode WebP. Other users may keep a public playlist as a favorite.
CREATE TABLE playlists (
 id text PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 50 AND name=btrim(name)),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=500),
 is_public boolean NOT NULL DEFAULT false,
 -- Exactly one bit of charts.category_flags.
 category_flag integer NOT NULL DEFAULT 16 CHECK(category_flag IN (1,2,4,8,16,32)),
 cover_file bigint REFERENCES chart_resources(id),
 game_cover_file bigint REFERENCES chart_resources(id),
 CHECK((cover_file IS NULL)=(game_cover_file IS NULL)),
 created_at timestamptz NOT NULL DEFAULT now(),
 -- Also moves when songs are added, removed or reordered.
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlists_owner ON playlists(owner_id,updated_at DESC,id);
CREATE INDEX playlists_public ON playlists(updated_at DESC,id) WHERE is_public;
CREATE INDEX playlists_cover_file ON playlists(cover_file);
CREATE INDEX playlists_game_cover_file ON playlists(game_cover_file);
-- A deleted song leaves every playlist. Positions order one playlist and need
-- not be contiguous; ties fall back to the time the song was added.
CREATE TABLE playlist_items (
 playlist_id text NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
 chart_id text NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position>=0),
 added_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(playlist_id,chart_id)
);
CREATE INDEX playlist_items_order ON playlist_items(playlist_id,position,added_at,chart_id);
CREATE INDEX playlist_items_chart ON playlist_items(chart_id);
-- A favorite of a playlist that turned private stays stored but is not shown.
CREATE TABLE playlist_favorites (
 playlist_id text NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id),
 favorited_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(playlist_id,user_id)
);
CREATE INDEX playlist_favorites_user ON playlist_favorites(user_id,favorited_at DESC);
-- Covers share chart_resources, so releasing one only queues the file. The
-- server deletes it once neither a chart nor a playlist refers to it.
CREATE FUNCTION retire_playlist_cover() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 INSERT INTO retired_files(storage_key) SELECT storage_key FROM chart_resources
  WHERE id IN (OLD.cover_file,OLD.game_cover_file)
   AND (TG_OP='DELETE' OR NOT id=ANY(array_remove(ARRAY[NEW.cover_file,NEW.game_cover_file],NULL)))
  ON CONFLICT DO NOTHING;
 RETURN NULL;
END;
$$;
CREATE TRIGGER playlists_retire_cover AFTER DELETE OR UPDATE OF cover_file,game_cover_file ON playlists
 FOR EACH ROW EXECUTE FUNCTION retire_playlist_cover();
