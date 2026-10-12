package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/cover"
)

func (s *Server) getPlaylistCover(w http.ResponseWriter, r *http.Request) {
	var digest, key string
	// The address of a private playlist's cover is its unguessable ID and hash.
	e := s.DB.QueryRow(r.Context(), `SELECT cv.sha256,cv.storage_key FROM chart_resources cv JOIN playlists p ON p.cover_file=cv.id WHERE p.id=$1`, r.PathValue("id")).Scan(&digest, &key)
	if errors.Is(e, pgx.ErrNoRows) || (e == nil && r.URL.Query().Get("v") != digest) {
		problem(w, 404, "COVER_NOT_FOUND", "封面不存在或已被替换")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.serveCover(w, r, digest, key)
}

// setPlaylistCover points a playlist at its website cover and the game's copy
// of it, or at neither.
func setPlaylistCover(ctx context.Context, tx pgx.Tx, id string, file, gameFile *int64) error {
	_, e := tx.Exec(ctx, `UPDATE playlists SET cover_file=$2,game_cover_file=$3,updated_at=now() WHERE id=$1`, id, file, gameFile)
	return e
}

func (s *Server) replacePlaylistCover(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	default:
		problem(w, 503, "UPLOAD_BUSY", "当前正在处理其他上传，请稍后重试")
		return
	}
	encoded, ok := receiveCover(w, r)
	if !ok {
		return
	}
	game, e := cover.GameImage(encoded)
	if e != nil {
		internal(w, e)
		return
	}
	// Ownership is checked after encoding, under the playlist's lock.
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		file, e := s.storeCover(r.Context(), tx, encoded)
		if e != nil {
			return false, e
		}
		gameFile, e := s.storeImage(r.Context(), tx, game, cover.GameExtension, cover.GameMediaType)
		if e != nil {
			return false, e
		}
		return true, setPlaylistCover(r.Context(), tx, r.PathValue("id"), &file, &gameFile)
	})
	if !ok {
		return
	}
	s.cleanupReplacedFiles()
	respond(w, 200, map[string]string{"coverHash": hash(string(encoded))})
}

func (s *Server) removePlaylistCover(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		return true, setPlaylistCover(r.Context(), tx, r.PathValue("id"), nil, nil)
	})
	if !ok {
		return
	}
	s.cleanupReplacedFiles()
	respond(w, 200, map[string]string{"coverHash": ""})
}
