package tja

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"ourtaiko.dev/fanmade/api/internal/audio"
	"ourtaiko.dev/fanmade/api/internal/charthash"
	"ourtaiko.dev/fanmade/api/internal/constants"
	"ourtaiko.dev/fanmade/api/internal/video"
)

const Version = "tja-upload-v11"
const MaxTJA = 2 * 1024 * 1024
const MaxAudio = 100 * 1024 * 1024

type Issue struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Line     int    `json:"line,omitempty"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
}

func (e *Issue) Error() string { return e.Message }
func fail(code, message string, line int) *Issue {
	return &Issue{Code: code, Message: message, Line: line}
}

// Difficulty is one chart block: a slot of course × side, as the arcade machine
// keeps a single, a 1P and a 2P chart per course. Side follows the block's
// #START: plain is "single", #START P1 "p1", #START P2 "p2". Branching reports
// a #BRANCHSTART inside the block, so song select can mark branch charts
// before the TJA is downloaded.
// Legacy fields are in-memory only, used by pre-028 database backfills.
type Difficulty struct {
	// ID is the chart_difficulties row; zero for a file not yet stored.
	ID        int64  `json:"id,omitempty"`
	Course    string `json:"course"`
	Side      string `json:"side"`
	Level     int    `json:"level"`
	Maker     string `json:"maker"`
	Branching bool   `json:"branching"`
	// Hash is the block's content hash from TJAParser ("v1:" + 64 hex): what the block plays
	// as, whatever its headers say. Scores and 段位 songs follow it (chart_difficulties.content_hash).
	Hash string `json:"chartHash,omitempty"`
	// Routes are the raw values of the difficulty constants (定数) TJAParser's notes give, by
	// route (difficulty_constants); nil when the tool reported no notes.
	Routes constants.Routes `json:"-"`
	// Constants are the block's published constants by route, in a chart's detail only.
	Constants          []constants.Shown `json:"constants,omitempty"`
	Line               int               `json:"-"`
	Warnings           []string          `json:"-"`
	BlockIndex         int               `json:"-"`
	Player             string            `json:"-"`
	Style              string            `json:"-"`
	CloudScoreEligible bool              `json:"-"`
}
type Metadata struct {
	Title                string            `json:"title"`
	Subtitle             string            `json:"subtitle"`
	TitleTranslations    map[string]string `json:"titleTranslations"`
	SubtitleTranslations map[string]string `json:"subtitleTranslations"`
	Maker                string            `json:"maker"`
	BPM                  float64           `json:"bpm"`
	Offset               float64           `json:"offset"`
	DemoStart            float64           `json:"demoStart"`
	Wave                 string            `json:"wave"`
	Movie                string            `json:"-"`
	MovieOffset          float64           `json:"movieOffset"`
	Difficulties         []Difficulty      `json:"difficulties"`
}

func SafeFilename(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 240 || strings.TrimSpace(s) != s {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || strings.ContainsRune(`/\:"<>|?*`, r) {
			return false
		}
	}
	return true
}

var number = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$`)
var localizedFields = map[string]string{"TITLEEN": "en", "SUBTITLEEN": "en", "TITLEJA": "ja", "TITLEZH": "zh", "TITLEKO": "ko", "SUBTITLEJA": "ja", "SUBTITLEZH": "zh", "SUBTITLEKO": "ko"}

func numeric(s string) (float64, bool) {
	n, e := strconv.ParseFloat(s, 64)
	return n, e == nil && number.MatchString(s) && !math.IsNaN(n) && !math.IsInf(n, 0)
}

// Inspector is the TJAParser tool that reads chart bodies: the game's own parser, built into
// the image at the tag the game references. The header checks below are the upload gate; the
// blocks, their hashes, the titles as the game reads them and the notes of the difficulty
// constants come from here. InspectDir holds the file it reads (the staging directory in
// production).
var Inspector charthash.Inspector = charthash.CLI{Bin: os.Getenv("TJAPARSER_BIN")}
var InspectDir = os.TempDir()

// Available reports whether the tool can be run, for tests that need it.
func Available() bool {
	cli, ok := Inspector.(charthash.CLI)
	if !ok {
		return Inspector != nil
	}
	_, err := exec.LookPath(cli.Bin)
	if cli.Bin == "" {
		_, err = exec.LookPath("tjaparser")
	}
	return err == nil
}

// Parse validates an upload and reads it as the game does. The header and structure rules of
// the upload contract (contracts/validation.json) are checked here first; the blocks and their
// content hashes then come from TJAParser, which also refuses what the game cannot list.
func Parse(data []byte, encoding, audioName string) (Metadata, *Issue) {
	m, issue := parse(data, encoding, audioName, true)
	if issue != nil {
		return m, issue
	}
	return inspect(m, data, encoding)
}

// ParseLegacy supports historical schema backfills before the mode migration: the header scan
// alone, with no block hashes.
func ParseLegacy(data []byte, encoding, audioName string) (Metadata, *Issue) {
	return parse(data, encoding, audioName, false)
}

// inspect completes a scanned chart with TJAParser's reading of it: titles by locale as the
// game maps them (origin + en/ja/ko/zh/zh_tw), each block's maker (NOTESDESIGNERn, else
// MAKER), content hash, parse warnings and the raw difficulty constants. A block the game
// cannot play is refused.
func inspect(m Metadata, data []byte, encoding string) (Metadata, *Issue) {
	normalized, issue := NormalizeUTF8(data, encoding)
	if issue != nil {
		return m, issue
	}
	result, err := charthash.InspectBytes(context.Background(), Inspector, InspectDir, normalized)
	var unreadable *charthash.Unreadable
	if errors.As(err, &unreadable) {
		return m, fail("TJA_STRUCTURE_INVALID", "游戏无法读取这个谱面文件："+unreadable.Message, issueLine(unreadable.Message))
	}
	if err != nil {
		return m, fail("TJA_PARSER_UNAVAILABLE", "谱面解析服务暂时不可用，请稍后重试", 0)
	}
	if len(result.Blocks) != len(m.Difficulties) {
		return m, fail("TJA_STRUCTURE_INVALID", fmt.Sprintf("谱面块数量不一致（校验 %d，解析 %d）", len(m.Difficulties), len(result.Blocks)), 0)
	}
	for i := range m.Difficulties {
		d, b := &m.Difficulties[i], result.Blocks[i]
		if d.Course != b.Name || d.Side != b.Side {
			return m, fail("TJA_STRUCTURE_INVALID", fmt.Sprintf("第 %d 个谱面块不一致（校验 %s/%s，解析 %s/%s）", i+1, d.Course, d.Side, b.Name, b.Side), b.Line)
		}
		if b.Error != "" {
			return m, fail("TJA_CHART_UNPLAYABLE", fmt.Sprintf("%s/%s 游戏无法播放：%s", b.Name, b.Side, b.Error), b.Line)
		}
		if b.Hash == "" {
			return m, fail("TJA_PARSER_UNAVAILABLE", "谱面解析服务没有给出内容哈希", b.Line)
		}
		d.Hash, d.Line, d.Warnings = b.Hash, b.Line, b.Warnings
		d.Routes = constants.OfRoutes(b.Notes)
		if b.Maker != "" {
			d.Maker = b.Maker
		}
	}
	m.TitleTranslations = result.Titles
	m.SubtitleTranslations = result.Subtitles
	if title, ok := result.Titles["origin"]; ok {
		m.Title = title
	}
	if subtitle, ok := result.Subtitles["origin"]; ok {
		m.Subtitle = subtitle
	}
	return m, nil
}

var lineInMessage = regexp.MustCompile(`\(lines? (\d+)`)

func issueLine(message string) int {
	if match := lineInMessage.FindStringSubmatch(message); match != nil {
		n, _ := strconv.Atoi(match[1])
		return n
	}
	return 0
}

func parse(data []byte, encoding, audioName string, uniform bool) (Metadata, *Issue) {
	m := Metadata{Difficulties: []Difficulty{}, TitleTranslations: map[string]string{}, SubtitleTranslations: map[string]string{}}
	data, issue := NormalizeUTF8(data, encoding)
	if issue != nil {
		return m, issue
	}
	text := string(data)
	waveLine, waves := 0, 0
	started, inBlock, hasNotes := false, false, false
	course, level := "Oni", 0
	style := "Single"
	singleCourses := map[string]int{}
	seenSlots := map[string]int{}
	seen := map[string]bool{}
	courses := map[string]string{"0": "Easy", "1": "Normal", "2": "Hard", "3": "Oni", "4": "Edit", "easy": "Easy", "normal": "Normal", "hard": "Hard", "oni": "Oni", "edit": "Edit"}
	for i, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := i + 1
		if len(raw) > 65536 {
			return m, fail("TJA_STRUCTURE_INVALID", "单行内容超过 64 KiB", line)
		}
		s := strings.TrimSpace(strings.SplitN(raw, "//", 2)[0])
		if s == "" {
			continue
		}
		if strings.HasPrefix(s, "#NEXTSONG") {
			return m, fail("TJA_RESOURCE_UNSUPPORTED", "示范版暂不支持切歌或额外资源", line)
		}
		if strings.HasPrefix(s, "#START") {
			if (s != "#START" && s != "#START P1" && s != "#START P2") || inBlock || level == 0 {
				return m, fail("TJA_STRUCTURE_INVALID", "每个谱面需要 LEVEL:1–10 和独立的 #START / #END", line)
			}
			started, inBlock, hasNotes = true, true, false
			player := strings.TrimSpace(strings.TrimPrefix(s, "#START"))
			blockStyle := style
			// Player-labelled blocks never qualify, even without STYLE:Double.
			if player != "" {
				blockStyle = "Double"
			}
			if blockStyle == "Single" {
				if firstLine, exists := singleCourses[course]; exists {
					return m, fail("TJA_DIFFICULTY_DUPLICATE", fmt.Sprintf("%s 难度存在重复单人谱面，第 %d 行已声明；每个难度只允许一个单人谱面块", course, firstLine), line)
				}
				singleCourses[course] = line
			}
			side := "single"
			if player != "" {
				side = strings.ToLower(player)
			}
			if uniform {
				if blockStyle == "Double" && player == "" {
					return m, fail("TJA_PLAYER_REQUIRED", "双人谱面必须使用 #START P1 或 #START P2", line)
				}
				slot := course + " " + side
				if first, exists := seenSlots[slot]; exists {
					return m, fail("TJA_DIFFICULTY_DUPLICATE", fmt.Sprintf("%s 难度重复，第 %d 行已声明", slot, first), line)
				}
				seenSlots[slot] = line
			}
			m.Difficulties = append(m.Difficulties, Difficulty{
				Course: course, Side: side, Level: level, BlockIndex: len(m.Difficulties), Player: player, Maker: m.Maker,
				Style: blockStyle, CloudScoreEligible: blockStyle == "Single" && player == "",
			})
			continue
		}
		if inBlock && len(s) >= 12 && strings.EqualFold(s[:12], "#BRANCHSTART") {
			m.Difficulties[len(m.Difficulties)-1].Branching = true
			continue
		}
		if s == "#END" {
			if !inBlock || !hasNotes {
				return m, fail("TJA_STRUCTURE_INVALID", "谱面块为空或 #END 没有对应的 #START", line)
			}
			inBlock = false
			continue
		}
		key, value, ok := strings.Cut(s, ":")
		if !ok {
			if inBlock && !strings.HasPrefix(s, "#") && strings.ContainsAny(s, "0123456789") {
				hasNotes = true
			}
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		upper := strings.ToUpper(key)
		if locale, ok := localizedFields[key]; ok {
			if started || seen[key] {
				return m, fail("TJA_STRUCTURE_INVALID", key+" 必须在谱面开始前且只声明一次", line)
			}
			if len(value) > 500 {
				return m, fail("TJA_STRUCTURE_INVALID", "元数据字段过长", line)
			}
			seen[key] = true
			if strings.HasPrefix(key, "SUBTITLE") {
				m.SubtitleTranslations[locale] = value
			} else {
				m.TitleTranslations[locale] = value
			}
			continue
		}
		if upper == "STYLE" {
			if inBlock {
				return m, fail("TJA_STRUCTURE_INVALID", "STYLE 必须位于谱面块之外", line)
			}
			switch strings.ToLower(value) {
			case "single", "0":
				style = "Single"
			case "double", "duet", "1":
				style = "Double"
			default:
				return m, fail("TJA_STRUCTURE_INVALID", "STYLE 需要 Single / Double（或 0 / 1）", line)
			}
			continue
		}
		if upper == "WAVE" {
			if key != "WAVE" {
				return m, fail("TJA_WAVE_INVALID", "请使用大写 WAVE:", line)
			}
			waves++
			if waves > 1 {
				return m, fail("TJA_WAVE_DUPLICATE", "只能声明一次 WAVE", line)
			}
			if started {
				return m, fail("TJA_WAVE_SCOPE_INVALID", "WAVE 必须位于第一个 #START 之前", line)
			}
			waveLine = line
			m.Wave = value
			continue
		}
		if upper == "LYRICS" || upper == "BGIMAGE" {
			if value != "" {
				return m, fail("TJA_RESOURCE_UNSUPPORTED", "不支持歌词或背景图片；仅接受 TJA、音频与可选的 BGMOVIE 视频", line)
			}
		}
		if upper == "BGMOVIE" || upper == "MOVIEOFFSET" {
			// Stored files have these headers rewritten or read back, so they
			// must be as unambiguous as WAVE.
			if key != upper || started || seen[key] {
				return m, fail("TJA_MOVIE_INVALID", "请使用大写 "+upper+":，位于第一个 #START 之前且只声明一次", line)
			}
			seen[key] = true
			if key == "BGMOVIE" {
				if value != "" && (!SafeFilename(value) || !video.ValidExtension(value)) {
					return m, fail("TJA_MOVIE_PATH_INVALID", "BGMOVIE 必须为不带路径、引号的 .mp4、.webm 或 .mov 文件名", line)
				}
				m.Movie = value
			} else if value != "" {
				n, valid := numeric(value)
				if !valid || math.Abs(n) > video.MaxDuration {
					return m, fail("TJA_MOVIE_OFFSET_INVALID", "MOVIEOFFSET 必须为秒数，绝对值不超过 1200", line)
				}
				m.MovieOffset = n
			}
			continue
		}
		if upper == "COURSE" {
			normalized := strings.ToLower(value)
			if normalized == "tower" || normalized == "dan" || normalized == "5" || normalized == "6" {
				return m, fail("TJA_COURSE_UNSUPPORTED", "不支持塔（Tower）或段位（Dan）谱面，请移除这些谱面块后重新上传", line)
			}
			c, ok := courses[normalized]
			if !ok || inBlock || key != "COURSE" {
				return m, fail("TJA_STRUCTURE_INVALID", "请使用大写 COURSE，难度需要 Easy / Normal / Hard / Oni / Edit（或 0–4）", line)
			}
			course, level = c, 0
			// STYLE belongs to the course header. A new course defaults to Single.
			style = "Single"
			continue
		}
		if key == "LEVEL" {
			n, e := strconv.Atoi(value)
			if e != nil || n < 1 || n > 10 || inBlock {
				return m, fail("TJA_STRUCTURE_INVALID", "LEVEL 必须是 1–10 的整数", line)
			}
			level = n
			continue
		}
		switch key {
		case "TITLE", "SUBTITLE", "MAKER", "BPM", "OFFSET", "DEMOSTART":
			if started || seen[key] {
				return m, fail("TJA_STRUCTURE_INVALID", key+" 必须在谱面开始前且只声明一次", line)
			}
			seen[key] = true
			if len(value) > 500 {
				return m, fail("TJA_STRUCTURE_INVALID", "元数据字段过长", line)
			}
			switch key {
			case "TITLE":
				m.Title = value
			case "SUBTITLE":
				m.Subtitle = value
			case "MAKER":
				m.Maker = value
			default:
				n, valid := numeric(value)
				if !valid {
					return m, fail("TJA_STRUCTURE_INVALID", key+" 必须为有限数字", line)
				}
				switch key {
				case "BPM":
					m.BPM = n
				case "OFFSET":
					m.Offset = n
				case "DEMOSTART":
					m.DemoStart = n
				}
			}
		}
	}
	if waves == 0 || m.Wave == "" {
		return m, fail("TJA_WAVE_MISSING", "TJA 缺少非空的 WAVE 音频引用", waveLine)
	}
	if !SafeFilename(m.Wave) || audio.MediaType(m.Wave) == "" {
		return m, fail("TJA_WAVE_PATH_INVALID", "WAVE 必须为不带路径、引号的 .ogg 或 .mp3 文件名", waveLine)
	}
	if !SafeFilename(audioName) {
		return m, fail("UPLOAD_FILENAME_INVALID", "上传文件名不能包含路径或特殊字符", 0)
	}
	if norm.NFC.String(m.Wave) != norm.NFC.String(audioName) {
		return m, &Issue{Code: "TJA_AUDIO_MISMATCH", Message: fmt.Sprintf("第 %d 行引用了「%s」，但你选择的是「%s」。请选择对应文件，或修改 TJA 的 WAVE 后重新选择。", waveLine, m.Wave, audioName), Line: waveLine, Expected: m.Wave, Actual: audioName}
	}
	if m.Title == "" || m.BPM <= 0 || inBlock || len(m.Difficulties) == 0 {
		return m, fail("TJA_STRUCTURE_INVALID", "需要 TITLE、正数 BPM 和完整谱面块", 0)
	}
	if _, ok := m.TitleTranslations["en"]; !ok {
		m.TitleTranslations["en"] = m.Title
	}
	if _, ok := m.SubtitleTranslations["en"]; !ok {
		m.SubtitleTranslations["en"] = m.Subtitle
	}
	return m, nil
}

// header returns the byte range of the named header line Parse accepts before
// the first #START, excluding its line ending, and the declared value.
func header(data []byte, name string) (start, end int, value string, ok bool) {
	for pos := 0; pos <= len(data); {
		stop := len(data)
		if i := strings.IndexByte(string(data[pos:]), '\n'); i >= 0 {
			stop = pos + i
		}
		raw := strings.TrimSuffix(string(data[pos:stop]), "\r")
		s := strings.TrimSpace(strings.SplitN(raw, "//", 2)[0])
		if strings.HasPrefix(s, "#START") {
			break
		}
		if key, v, found := strings.Cut(s, ":"); found && strings.TrimSpace(key) == name {
			return pos, pos + len(raw), strings.TrimSpace(v), true
		}
		pos = stop + 1
	}
	return 0, 0, "", false
}

// WaveName returns the audio file name declared by a stored UTF-8 TJA.
func WaveName(data []byte) string {
	_, _, value, _ := header(data, "WAVE")
	return value
}

// MovieName returns the background movie file name declared by a stored TJA.
func MovieName(data []byte) string {
	_, _, value, _ := header(data, "BGMOVIE")
	return value
}

// SetWave points the WAVE header at name, leaving every other byte unchanged.
// Stored charts reference their audio by its content-addressed file name.
func SetWave(data []byte, name string) ([]byte, bool) { return setHeader(data, "WAVE", name) }

// SetMovie points the BGMOVIE header at the stored movie in the same way.
func SetMovie(data []byte, name string) ([]byte, bool) { return setHeader(data, "BGMOVIE", name) }

func setHeader(data []byte, key, value string) ([]byte, bool) {
	start, end, _, ok := header(data, key)
	if !ok {
		return nil, false
	}
	out := make([]byte, 0, len(data)+len(value))
	out = append(out, data[:start]...)
	out = append(out, key+":"+value...)
	return append(out, data[end:]...), true
}
