package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// 段位 courses in the format of OurTaikoPlay's .otdan.json (OurTaikoLogs DanDojo.md): one to
// three chart blocks with conditions. The website keeps them, the game reads them from
// GET /api/v1/game/dans and reports attempts to POST /api/v1/game/dan-attempts, which asks
// OurTaikoProfile for the titles and 段位 badge they earn.

const danMaxSongs = 3

// rewards.dan names the 段位 an official course stands for: 五級 (6) .. 達人 (24). The numbering
// starts at 初級 (0), but the game does not offer 0–5.
const danFirst, danLast = 6, 24

// A player publishes at most this many courses that are not official; the ones administrators
// mark official do not count.
const danCommunityLimit = 10

var danLanguages = map[string]bool{"ja": true, "en": true, "zh": true, "zh_tw": true, "ko": true}
var danExamTypes = map[string]bool{"gauge": true, "good": true, "ok": true, "bad": true, "hits": true, "score": true, "combo": true, "rolls": true}
var danCourses = map[string]bool{"Easy": true, "Normal": true, "Hard": true, "Oni": true, "Edit": true}
var profileTitleID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// A reward title is given at this verdict or better: red 1, gold 4, or one of red1..gold6.
var danRewardLevels = map[string]int{"red": 1, "gold": 4, "red1": 1, "red2": 2, "red3": 3, "gold4": 4, "gold5": 5, "gold6": 6}

// DanSongChart names the block a course song plays: a chart, a course and a side.
type DanSongChart struct {
	ID     string `json:"id"`
	Course string `json:"course"`
	Side   string `json:"side"`
}

// DanSong is a song of a course: the block the game plays, with what the website shows.
type DanSong struct {
	Chart    DanSongChart `json:"chart"`
	Title    string       `json:"title"`
	Subtitle string       `json:"subtitle"`
	Hidden   bool         `json:"hidden"`
	// The block's level; Valid is false once the block's content changed or went (the
	// chart_difficulties triggers), until the maker picks a block again. Available is Valid
	// and the chart still published: what the game may challenge.
	Level     int  `json:"level"`
	Valid     bool `json:"valid"`
	Available bool `json:"available"`
}

type DanCourse struct {
	Format int               `json:"format"`
	ID     string            `json:"id"`
	Title  map[string]string `json:"title"`
	Color  int               `json:"color"`
	// Six capital letters or digits, unique on this server: the game's 外伝 entry takes it.
	Code      string          `json:"code"`
	Official  bool            `json:"official"`
	Songs     []DanSong       `json:"songs"`
	Exams     json.RawMessage `json:"exams"`
	Rewards   json.RawMessage `json:"rewards"`
	OwnerID   string          `json:"ownerId"`
	Owner     string          `json:"owner"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
	// Votes and comments as on songs; MyVote is only filled on the detail page.
	Score        int `json:"score"`
	Upvotes      int `json:"upvotes"`
	Downvotes    int `json:"downvotes"`
	CommentCount int `json:"commentCount"`
	MyVote       int `json:"myVote"`
}

type danRewards struct {
	Dan    *int `json:"dan,omitempty"`
	Titles []struct {
		ID string `json:"id"`
		On string `json:"on"`
	} `json:"titles,omitempty"`
}

// danInput is what the website sends to create or change a course.
type danInput struct {
	Title map[string]string `json:"title"`
	Color int               `json:"color"`
	// Optional on creation; ignored on an update.
	Code  string `json:"code"`
	Songs []struct {
		ChartID string `json:"chartId"`
		Course  string `json:"course"`
		// The block's side (single, p1, p2): the maker picks one of those the course has.
		Side   string `json:"side"`
		Hidden bool   `json:"hidden"`
	} `json:"songs"`
	Exams   json.RawMessage `json:"exams"`
	Rewards json.RawMessage `json:"rewards"`
}

func validDanNumber(v json.RawMessage, gauge bool) (int64, bool) {
	n, err := strconv.ParseInt(string(v), 10, 64)
	return n, err == nil && n >= 0 && n <= 1_000_000_000 && (!gauge || n <= 100)
}

// validDanLine is [red] or [red, gold]; a "less" red line must leave room (above 0).
func validDanLine(v json.RawMessage, gauge, less bool) bool {
	var line []json.RawMessage
	if json.Unmarshal(v, &line) != nil || len(line) < 1 || len(line) > 2 {
		return false
	}
	for i, n := range line {
		value, ok := validDanNumber(n, gauge)
		if !ok || (i == 0 && less && value == 0) {
			return false
		}
	}
	return true
}

// cleanDanExams checks the conditions as the game reads them: a gauge exam over the course,
// at most three others, each line [red] / [red, gold] or one item (or null) per song.
func cleanDanExams(raw json.RawMessage, songs int) (json.RawMessage, bool) {
	var exams []struct {
		Type  string          `json:"type"`
		Range string          `json:"range"`
		Value json.RawMessage `json:"value"`
	}
	if json.Unmarshal(raw, &exams) != nil || len(exams) == 0 {
		return nil, false
	}
	gauges, others := 0, 0
	for _, exam := range exams {
		gauge := exam.Type == "gauge"
		less := exam.Range == "less"
		if !danExamTypes[exam.Type] || (exam.Range != "more" && !less) {
			return nil, false
		}
		if gauge {
			gauges++
		} else {
			others++
		}
		var items []json.RawMessage
		if json.Unmarshal(exam.Value, &items) != nil || len(items) == 0 {
			return nil, false
		}
		if items[0][0] == '[' || string(items[0]) == "null" {
			// One per song; the game refuses a per-song gauge.
			if gauge || len(items) != songs {
				return nil, false
			}
			set := 0
			for _, item := range items {
				if string(item) == "null" {
					continue
				}
				if !validDanLine(item, false, less) {
					return nil, false
				}
				set++
			}
			if set == 0 {
				return nil, false
			}
		} else if !validDanLine(exam.Value, gauge, less) {
			return nil, false
		}
	}
	if gauges > 1 || others > 3 {
		return nil, false
	}
	clean, _ := json.Marshal(exams)
	return clean, true
}

func cleanDanRewards(raw json.RawMessage) (json.RawMessage, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(`{}`), true
	}
	var rewards danRewards
	if json.Unmarshal(raw, &rewards) != nil || (rewards.Dan != nil && (*rewards.Dan < danFirst || *rewards.Dan > danLast)) || len(rewards.Titles) > 10 {
		return nil, false
	}
	for _, title := range rewards.Titles {
		if !profileTitleID.MatchString(title.ID) || danRewardLevels[title.On] == 0 {
			return nil, false
		}
	}
	clean, _ := json.Marshal(rewards)
	return clean, true
}

type danSongRow struct {
	chartID, course, side string
	hidden                bool
}

var danSides = map[string]bool{"single": true, "p1": true, "p2": true}

// checkDan validates a course from the website (made by owner): each song names a block the
// chart has now, by course and side.
func (s *Server) checkDan(ctx context.Context, w http.ResponseWriter, in danInput, owner string) (map[string]string, []danSongRow, json.RawMessage, json.RawMessage, bool) {
	title := map[string]string{}
	for language, text := range in.Title {
		text = strings.TrimSpace(text)
		if !danLanguages[language] || utf8.RuneCountInString(text) > 40 {
			problem(w, 422, "DAN_INVALID", "段位名称无效")
			return nil, nil, nil, nil, false
		}
		if text != "" {
			title[language] = text
		}
	}
	// color 0–6 is the Nijiiro skin's dan box; its 1 is the same wood as 0, so it is not offered.
	if len(title) == 0 || in.Color < 0 || in.Color > 6 || in.Color == 1 || len(in.Songs) == 0 || len(in.Songs) > danMaxSongs {
		problem(w, 422, "DAN_INVALID", "段位需要名称和 1–3 首歌曲")
		return nil, nil, nil, nil, false
	}
	exams, ok := cleanDanExams(in.Exams, len(in.Songs))
	if !ok {
		problem(w, 422, "DAN_EXAMS_INVALID", "合格条件无效")
		return nil, nil, nil, nil, false
	}
	rewards, ok := cleanDanRewards(in.Rewards)
	if !ok {
		problem(w, 422, "DAN_REWARDS_INVALID", "奖励设置无效")
		return nil, nil, nil, nil, false
	}
	if !s.checkDanTitles(ctx, w, rewards, owner) {
		return nil, nil, nil, nil, false
	}
	songs := []danSongRow{}
	for _, song := range in.Songs {
		if !danCourses[song.Course] {
			problem(w, 422, "DAN_INVALID", "难度无效")
			return nil, nil, nil, nil, false
		}
		if !danSides[song.Side] {
			problem(w, 422, "DAN_SIDE_REQUIRED", "请为每首歌选择要挑战的谱面块（单人／1P／2P）")
			return nil, nil, nil, nil, false
		}
		var hashed bool
		err := s.DB.QueryRow(ctx, `SELECT d.content_hash IS NOT NULL FROM charts c JOIN chart_difficulties d ON d.chart_id=c.id
 WHERE c.id=$1 AND `+publishedChart+` AND d.course=$2 AND d.side=$3`, song.ChartID, song.Course, song.Side).Scan(&hashed)
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, 422, "DAN_SONG_NOT_FOUND", "找不到歌曲或该难度的这个谱面块："+song.ChartID)
			return nil, nil, nil, nil, false
		}
		if err != nil {
			internal(w, err)
			return nil, nil, nil, nil, false
		}
		if !hashed {
			problem(w, 422, "DAN_SONG_NOT_FOUND", "这个谱面块还没有内容哈希，请稍后再试："+song.ChartID)
			return nil, nil, nil, nil, false
		}
		songs = append(songs, danSongRow{chartID: song.ChartID, course: song.Course, side: song.Side, hidden: song.Hidden})
	}
	return title, songs, exams, rewards, true
}

// checkDanTitles makes sure each reward title is one the course can give: it is on
// OurTaikoProfile, and official or a community title of the course's maker (or of Profile's
// administrators). An official title on a course that is not official yet is accepted: Profile
// gives it once the course is. Without Profile, or while it does not answer, titles are not
// checked; Profile skips the ones it cannot give.
func (s *Server) checkDanTitles(ctx context.Context, w http.ResponseWriter, rewards json.RawMessage, owner string) bool {
	var r danRewards
	json.Unmarshal(rewards, &r)
	if s.Config.Profile == nil || len(r.Titles) == 0 {
		return true
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	// A title made a moment ago may not be in the kept catalog yet: one more look before saying no.
	for _, fresh := range []bool{false, true} {
		titles, err := s.Config.Profile.Titles(ctx, fresh)
		if err != nil {
			log.Printf("dan reward titles not checked: %v", err)
			return true
		}
		code, message, id := "", "", ""
		for _, reward := range r.Titles {
			title, found := titles[reward.ID]
			if !found {
				code, message, id = "DAN_TITLE_NOT_FOUND", "称号不存在：", reward.ID
				break
			}
			if !title.Official && title.OwnerID != nil && *title.OwnerID != owner {
				code, message, id = "DAN_TITLE_NOT_OWNED", "只能使用段位创建者自己的社区称号或官方称号：", reward.ID
				break
			}
		}
		if code == "" {
			return true
		}
		if fresh {
			problem(w, 422, code, message+id)
		}
	}
	return false
}

const danColumns = `d.id,d.owner_id,d.title,d.color,d.official,d.exams,d.rewards,d.created_at,d.updated_at,d.code,d.upvotes,d.downvotes,d.comment_count`

// loadDans reads courses (where: a condition on dan_courses d) with their songs as they are now.
func (s *Server) loadDans(ctx context.Context, where string, args ...any) ([]DanCourse, error) {
	rows, err := s.DB.Query(ctx, `SELECT `+danColumns+` FROM dan_courses d WHERE d.status='published' AND `+where+` ORDER BY d.official DESC,d.created_at DESC,d.id DESC LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	courses := []DanCourse{}
	index := map[string]int{}
	for rows.Next() {
		var c DanCourse
		var title, exams, rewards []byte
		if err = rows.Scan(&c.ID, &c.OwnerID, &title, &c.Color, &c.Official, &exams, &rewards, &c.CreatedAt, &c.UpdatedAt, &c.Code, &c.Upvotes, &c.Downvotes, &c.CommentCount); err != nil {
			rows.Close()
			return nil, err
		}
		c.Format, c.Exams, c.Rewards, c.Songs, c.Score = 1, exams, rewards, []DanSong{}, c.Upvotes-c.Downvotes
		json.Unmarshal(title, &c.Title)
		index[c.ID] = len(courses)
		courses = append(courses, c)
	}
	rows.Close()
	if err = rows.Err(); err != nil || len(courses) == 0 {
		return courses, err
	}
	ids := []string{}
	for _, c := range courses {
		ids = append(ids, c.ID)
	}
	rows, err = s.DB.Query(ctx, `SELECT s.course_id,s.chart_id,s.course,s.side,s.hidden,COALESCE(c.title,''),COALESCE(c.subtitle,''),
 COALESCE((SELECT b.level FROM chart_difficulties b WHERE b.chart_id=s.chart_id AND b.course=s.course AND b.side=s.side),0),
 s.valid,COALESCE(c.status='published' AND s.valid,false)
 FROM dan_course_songs s LEFT JOIN charts c ON c.id=s.chart_id
 WHERE s.course_id=ANY($1) ORDER BY s.course_id,s.position`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var course string
		var song DanSong
		if err = rows.Scan(&course, &song.Chart.ID, &song.Chart.Course, &song.Chart.Side, &song.Hidden, &song.Title, &song.Subtitle, &song.Level, &song.Valid, &song.Available); err != nil {
			return nil, err
		}
		c := &courses[index[course]]
		c.Songs = append(c.Songs, song)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	owners := []string{}
	seen := map[string]bool{}
	for _, c := range courses {
		if !seen[c.OwnerID] {
			seen[c.OwnerID] = true
			owners = append(owners, c.OwnerID)
		}
	}
	if s.Config.SSO != nil {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if names, err := s.Config.SSO.Profiles(ctx, owners); err == nil {
			for i := range courses {
				courses[i].Owner = names[courses[i].OwnerID].Nickname
			}
		}
	}
	return courses, nil
}

func (s *Server) listDans(w http.ResponseWriter, r *http.Request) {
	courses, err := s.loadDans(r.Context(), `true`)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"dans": courses})
}

func (s *Server) danDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	courses, err := s.loadDans(r.Context(), `d.id=$1`, id)
	if err != nil {
		internal(w, err)
		return
	}
	if len(courses) == 0 {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	if viewer := s.viewer(r); viewer != "" {
		s.DB.QueryRow(r.Context(), `SELECT value FROM dan_votes WHERE dan_id=$1 AND user_id=$2`, id, viewer).Scan(&courses[0].MyVote)
	}
	respond(w, 200, courses[0])
}

func (s *Server) saveDanSongs(ctx context.Context, tx pgx.Tx, course string, songs []danSongRow) error {
	if _, err := tx.Exec(ctx, `DELETE FROM dan_course_songs WHERE course_id=$1`, course); err != nil {
		return err
	}
	for i, song := range songs {
		if _, err := tx.Exec(ctx, `INSERT INTO dan_course_songs(course_id,position,chart_id,course,side,hidden,valid) VALUES($1,$2,$3,$4,$5,$6,true)`, course, i, song.chartID, song.course, song.side, song.hidden); err != nil {
			return err
		}
	}
	return nil
}

// createDan is POST /api/v1/dans: any signed-in user publishes a course (not official).
func (s *Server) createDan(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var in danInput
	if !decode(w, r, &in) {
		return
	}
	title, songs, exams, rewards, ok := s.checkDan(r.Context(), w, in, u.User.ID)
	if !ok {
		return
	}
	titleJSON, _ := json.Marshal(title)
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(ctx)
	// A player's courses one at a time, so two requests cannot both take the last place.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('dan-courses:'||$1,0))`, u.User.ID); err != nil {
		internal(w, err)
		return
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM dan_courses WHERE owner_id=$1 AND status='published' AND NOT official`, u.User.ID).Scan(&count); err != nil {
		internal(w, err)
		return
	}
	if count >= danCommunityLimit {
		problem(w, 409, "DAN_LIMIT_REACHED", "每人最多发布 10 个非官方段位")
		return
	}
	var id string
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	if code != "" && !danCodePattern.MatchString(code) {
		problem(w, 422, "DAN_CODE_INVALID", "段位码需为 6 位大写字母或数字")
		return
	}
	// A chosen code must be free; a random one is drawn until it is. Two makers drawing the
	// same code at once would trip the unique index, which is as unlikely as it sounds.
	for taken := true; taken; {
		if code == "" {
			code = randomDanCode()
		}
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM dan_courses WHERE code=$1)`, code).Scan(&taken); err != nil {
			internal(w, err)
			return
		}
		if taken && in.Code != "" {
			problem(w, 409, "DAN_CODE_TAKEN", "这个段位码已被使用")
			return
		}
		if taken {
			code = ""
		}
	}
	id = ID()
	if _, err = tx.Exec(ctx, `INSERT INTO dan_courses(id,owner_id,title,color,code,exams,rewards) VALUES($7,$1,$2,$3,$4,$5,$6)`, u.User.ID, titleJSON, in.Color, code, exams, rewards, id); err != nil {
		internal(w, err)
		return
	}
	if err = s.saveDanSongs(ctx, tx, id, songs); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		internal(w, err)
		return
	}
	courses, err := s.loadDans(ctx, `d.id=$1`, id)
	if err != nil || len(courses) == 0 {
		internal(w, err)
		return
	}
	respond(w, 201, courses[0])
}

// ownDan is the course (and its maker) for its owner or an administrator to change.
func (s *Server) ownDan(w http.ResponseWriter, r *http.Request) (session, string, string, bool) {
	u, ok := s.required(w, r, true)
	if !ok {
		return u, "", "", false
	}
	id := r.PathValue("id")
	var owner string
	err := pgx.ErrNoRows
	if validID(id) {
		err = s.DB.QueryRow(r.Context(), `SELECT owner_id FROM dan_courses WHERE id=$1 AND status='published'`, id).Scan(&owner)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		} else {
			internal(w, err)
		}
		return u, "", "", false
	}
	if owner != u.User.ID && !u.User.IsAdmin {
		problem(w, 403, "FORBIDDEN", "只有创建者或管理员可以修改")
		return u, "", "", false
	}
	return u, id, owner, true
}

func (s *Server) updateDan(w http.ResponseWriter, r *http.Request) {
	_, id, owner, ok := s.ownDan(w, r)
	if !ok {
		return
	}
	var in danInput
	if !decode(w, r, &in) {
		return
	}
	title, songs, exams, rewards, ok := s.checkDan(r.Context(), w, in, owner)
	if !ok {
		return
	}
	titleJSON, _ := json.Marshal(title)
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE dan_courses SET title=$2,color=$3,exams=$4,rewards=$5,updated_at=now() WHERE id=$1`, id, titleJSON, in.Color, exams, rewards); err != nil {
		internal(w, err)
		return
	}
	if err = s.saveDanSongs(ctx, tx, id, songs); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		internal(w, err)
		return
	}
	courses, err := s.loadDans(ctx, `d.id=$1`, id)
	if err != nil || len(courses) == 0 {
		internal(w, err)
		return
	}
	respond(w, 200, courses[0])
}

// deleteDan takes a course off the lists; its attempts stay recorded.
func (s *Server) deleteDan(w http.ResponseWriter, r *http.Request) {
	_, id, _, ok := s.ownDan(w, r)
	if !ok {
		return
	}
	if _, err := s.DB.Exec(r.Context(), `UPDATE dan_courses SET status='deleted',updated_at=now() WHERE id=$1`, id); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

// markDanOfficial is PUT /api/v1/dans/{id}/official {official}: administrators only.
func (s *Server) markDanOfficial(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	if !u.User.IsAdmin {
		problem(w, 403, "FORBIDDEN", "需要管理员权限")
		return
	}
	var body struct {
		Official bool `json:"official"`
	}
	if !decode(w, r, &body) {
		return
	}
	tag, err := s.DB.Exec(r.Context(), `UPDATE dan_courses SET official=$2,updated_at=now() WHERE id=$1 AND status='published'`, r.PathValue("id"), body.Official)
	if err != nil {
		internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	respond(w, 200, map[string]bool{"official": body.Official})
}

// gameDans is GET /api/v1/game/dans: the official courses for the game's list, which finds
// the songs in this server's catalog and greys a course whose chart changed (tjaHash). The
// other courses are reached by code (gameDanByCode).
func (s *Server) gameDans(w http.ResponseWriter, r *http.Request) {
	courses, err := s.loadDans(r.Context(), `d.official`)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"dans": courses, "danVersion": 1})
}

// gameDanByCode is GET /api/v1/game/dans/{code}: one published course, official or not, by
// the code the game's 外伝 entry took. A course with a song that is no longer available is
// not found: the game only challenges courses it can play whole.
func (s *Server) gameDanByCode(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	if !danCodePattern.MatchString(code) {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	courses, err := s.loadDans(r.Context(), `d.code=$1`, code)
	if err != nil {
		internal(w, err)
		return
	}
	if len(courses) == 0 || !danPlayable(courses[0]) {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	respond(w, 200, courses[0])
}

// danPlayable: every song of the course is still the block it was set up on.
func danPlayable(c DanCourse) bool {
	for _, song := range c.Songs {
		if !song.Available {
			return false
		}
	}
	return len(c.Songs) > 0
}

var danCodePattern = regexp.MustCompile(`^[A-Z0-9]{6}$`)

const danCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// randomDanCode draws six characters evenly from the alphabet.
func randomDanCode() string {
	var raw [6]byte
	rand.Read(raw[:])
	code := make([]byte, 6)
	for i, b := range raw {
		code[i] = danCodeAlphabet[int(b)%len(danCodeAlphabet)]
	}
	return string(code)
}

// DanAttempt is a recorded attempt.
type DanAttempt struct {
	ID          string    `json:"id"`
	CourseID    string    `json:"courseId"`
	Verdict     int       `json:"verdict"`
	SongsPlayed int       `json:"songsPlayed"`
	SubmittedAt time.Time `json:"submittedAt"`
}

// submitDanAttempt is POST /api/v1/game/dan-attempts {courseId, verdict 0–6, songsPlayed}
// with an Idempotency-Key, from a signed-in game. The result is trusted as single scores are.
// When OurTaikoProfile is configured it is asked for what the attempt earns; its reply is kept,
// and a retry of an attempt it did not answer asks again (profileError: Profile could not be
// reached or failed). profileRejected (Profile's error code) means it never will. The songs'
// own scores go to POST /api/v1/game/scores as usual.
func (s *Server) submitDanAttempt(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, false)
	if !ok {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 8 || len(key) > 128 || strings.ContainsFunc(key, func(c rune) bool { return c < 0x21 || c > 0x7e }) {
		problem(w, 400, "IDEMPOTENCY_KEY_INVALID", "需要 Idempotency-Key")
		return
	}
	var body struct {
		CourseID    string `json:"courseId"`
		Verdict     int    `json:"verdict"`
		SongsPlayed int    `json:"songsPlayed"`
	}
	if !decode(w, r, &body) {
		return
	}
	course := body.CourseID
	if !validID(course) || body.Verdict < 0 || body.Verdict > 6 || body.SongsPlayed < 0 || body.SongsPlayed > danMaxSongs {
		problem(w, 422, "DAN_ATTEMPT_INVALID", "段位成绩无效")
		return
	}
	ctx := r.Context()
	courses, err := s.loadDans(ctx, `d.id=$1`, course)
	if err != nil {
		internal(w, err)
		return
	}
	if len(courses) == 0 {
		problem(w, 404, "DAN_NOT_FOUND", "段位不存在")
		return
	}
	c := courses[0]
	digest := hash(strings.Join([]string{body.CourseID, strconv.Itoa(body.Verdict), strconv.Itoa(body.SongsPlayed)}, "|"))
	var a DanAttempt
	var stored string
	var granted []byte
	err = s.DB.QueryRow(ctx, `INSERT INTO dan_attempts(id,course_id,user_id,idempotency_key,payload_digest,verdict,songs_played) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id,course_id,verdict,songs_played,submitted_at,payload_digest,granted`,
		ID(), course, u.User.ID, key, digest, body.Verdict, body.SongsPlayed).Scan(&a.ID, &a.CourseID, &a.Verdict, &a.SongsPlayed, &a.SubmittedAt, &stored, &granted)
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.DB.QueryRow(ctx, `SELECT id,course_id,verdict,songs_played,submitted_at,payload_digest,granted FROM dan_attempts WHERE user_id=$1 AND idempotency_key=$2`, u.User.ID, key).
			Scan(&a.ID, &a.CourseID, &a.Verdict, &a.SongsPlayed, &a.SubmittedAt, &stored, &granted)
		if err == nil && stored != digest {
			problem(w, 409, "IDEMPOTENCY_CONFLICT", "同一个 Idempotency-Key 对应了不同的成绩")
			return
		}
	}
	if err != nil {
		internal(w, err)
		return
	}
	reply := map[string]any{"attempt": a, "profile": nil}
	if granted != nil {
		reply["profile"] = json.RawMessage(granted)
	} else if s.Config.Profile != nil {
		answer, err := s.Config.Profile.Award(ctx, danAward(c, a, u.User.ID))
		var rejected *ProfileRejection
		if errors.As(err, &rejected) {
			// Profile will never take this attempt; without profileError the game stops sending it.
			reply["profileRejected"] = rejected.Code
		} else if err != nil {
			reply["profileError"] = err.Error()
		} else {
			if _, err = s.DB.Exec(ctx, `UPDATE dan_attempts SET granted=$2 WHERE id=$1`, a.ID, []byte(answer)); err != nil {
				internal(w, err)
				return
			}
			reply["profile"] = answer
		}
	}
	respond(w, 200, reply)
}

// danAward is what Profile is asked to give for an attempt: the course's 段位 (official
// courses only) and the reward titles whose level the verdict reached. Profile gives a
// player's community title only for that player's courses, so it is told who made the course.
func danAward(c DanCourse, a DanAttempt, user string) AwardRequest {
	request := AwardRequest{Key: a.ID, UserID: user, CourseID: c.ID, CourseOwner: c.OwnerID, Official: c.Official, Verdict: a.Verdict, Titles: []string{}}
	for _, language := range []string{"ja", "zh", "en", "ko", "zh_tw"} {
		if title := c.Title[language]; title != "" {
			request.CourseTitle = title
			break
		}
	}
	var rewards danRewards
	json.Unmarshal(c.Rewards, &rewards)
	if c.Official && rewards.Dan != nil {
		request.Dan = rewards.Dan
	}
	for _, title := range rewards.Titles {
		if level := danRewardLevels[title.On]; level > 0 && a.Verdict >= level {
			request.Titles = append(request.Titles, title.ID)
		}
	}
	return request
}
