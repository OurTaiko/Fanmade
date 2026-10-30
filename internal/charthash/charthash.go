// Package charthash runs the TJAParser command-line tool (github.com/OurTaiko/TJAParser,
// the parser OurTaikoPlay plays by) over a TJA file and reads back what the servers register
// a chart from: the header, every #START block, each block's content hash and the notes each
// of its routes plays (for the difficulty constants).
//
// The tool is built into the container image at the tag the game references; the servers never
// parse chart bodies themselves. `tjaparser inspect <file>` prints one JSON document; its
// exit code 4 means the file is not a chart the game can list (an unsupported COURSE, a
// repeated difficulty and side, a #START player other than P1/P2), reported as *Unreadable.
package charthash

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"ourtaiko.dev/sitekit/constants"
)

// Inspection is `tjaparser inspect`'s output.
type Inspection struct {
	Version int    `json:"version"`
	Prefix  string `json:"prefix"`
	// TITLE*/SUBTITLE* as written: "origin" is TITLE/SUBTITLE itself, the other keys are locales.
	Titles         map[string]string `json:"titles"`
	Subtitles      map[string]string `json:"subtitles"`
	Genre          string            `json:"genre"`
	Maker          string            `json:"maker"`
	NotesDesigners map[string]string `json:"notesDesigners"`
	BPM            float64           `json:"bpm"`
	Offset         float64           `json:"offset"`
	DemoStart      float64           `json:"demoStart"`
	Wave           string            `json:"wave"`
	Movie          string            `json:"movie"`
	MovieOffset    float64           `json:"movieOffset"`
	Blocks         []Block           `json:"blocks"`
}

// Block is one #START block in file order.
type Block struct {
	Line      int    `json:"line"`
	Course    string `json:"course"` // COURSE as written
	Name      string `json:"name"`   // Easy, Normal, Hard, Oni or Edit
	Side      string `json:"side"`   // single, p1, p2
	Player    string `json:"player"` // after #START, upper-case: "", P1, P2
	Style     string `json:"style"`  // STYLE in force, as written
	Level     int    `json:"level"`
	Branching bool   `json:"branching"`
	HasNotes  bool   `json:"hasNotes"`
	Maker     string `json:"maker"` // NOTESDESIGNERn of the course, else MAKER
	// The content hash ("v1:" + 64 hex), or why the game cannot play the block.
	Hash     string   `json:"hash"`
	Error    string   `json:"error"`
	Warnings []string `json:"warnings"`
	// The don and ka notes each route plays ("unbranched", or "normal", "expert", "master"),
	// for the difficulty constants; absent when the block cannot be played.
	Notes map[string]constants.Notes `json:"notes"`
}

// Unreadable is the tool refusing the file as a whole (exit code 4): its message names the
// line, for the uploader.
type Unreadable struct{ Message string }

func (e *Unreadable) Error() string { return e.Message }

// Inspector inspects a TJA file on disk. The one implementation shells out; tests may fake it.
type Inspector interface {
	Inspect(ctx context.Context, path string) (Inspection, error)
}

// CLI runs the tjaparser executable.
type CLI struct {
	Bin     string        // path or name of the executable; "tjaparser" when empty
	Timeout time.Duration // per run; 20 s when zero
}

// Env keeps the tool's .NET runtime small and quiet.
var env = []string{"DOTNET_GCHeapHardLimit=0x10000000", "DOTNET_TieredPGO=0", "DOTNET_CLI_TELEMETRY_OPTOUT=1", "DOTNET_NOLOGO=1"}

func (c CLI) bin() string {
	if c.Bin == "" {
		return "tjaparser"
	}
	return c.Bin
}

// Version runs `tjaparser version`: the hash algorithm version, such as "v1". A server calls
// it at startup so a missing or broken tool fails the start, not the first upload.
func (c CLI) Version(ctx context.Context) (string, error) {
	out, err := c.run(ctx, "version")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (c CLI) Inspect(ctx context.Context, path string) (Inspection, error) {
	var result Inspection
	out, err := c.run(ctx, "inspect", path)
	if err != nil {
		return result, err
	}
	if err = json.Unmarshal(out, &result); err != nil {
		return result, fmt.Errorf("tjaparser inspect: %w", err)
	}
	if result.Titles == nil {
		result.Titles = map[string]string{}
	}
	if result.Subtitles == nil {
		result.Subtitles = map[string]string{}
	}
	if result.NotesDesigners == nil {
		result.NotesDesigners = map[string]string{}
	}
	return result, nil
}

func (c CLI) run(ctx context.Context, args ...string) ([]byte, error) {
	timeout := c.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.bin(), args...)
	cmd.Env = append(os.Environ(), env...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return stdout.Bytes(), nil
	case errors.As(err, &exit) && exit.ExitCode() == 4:
		return nil, &Unreadable{Message: strings.TrimSpace(strings.TrimPrefix(stderr.String(), "tjaparser: "))}
	case ctx.Err() != nil:
		return nil, fmt.Errorf("tjaparser %s: %w", args[0], ctx.Err())
	default:
		return nil, fmt.Errorf("tjaparser %s: %w: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
}

// InspectBytes writes the text to a file in dir and inspects it.
func InspectBytes(ctx context.Context, inspector Inspector, dir string, data []byte) (Inspection, error) {
	f, err := os.CreateTemp(dir, "inspect-*.tja")
	if err != nil {
		return Inspection{}, err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return Inspection{}, err
	}
	return inspector.Inspect(ctx, f.Name())
}
