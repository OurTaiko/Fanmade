// Package cover validates still-image uploads and stores only normalized WebP bytes.
package cover

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const MaxBytes = 8 * 1024 * 1024
const MaxPixels = 16_000_000
const MaxDimension = 8192

var ErrInvalid = errors.New("invalid cover image")

func ValidExtension(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp"
}

func Encode(ctx context.Context, name string, data []byte) ([]byte, error) {
	if !ValidExtension(name) || len(data) == 0 || len(data) > MaxBytes {
		return nil, ErrInvalid
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	expected := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if strings.EqualFold(filepath.Ext(name), ".jpg") {
		expected = "jpeg"
	}
	if err != nil || format != expected || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > MaxDimension || cfg.Height > MaxDimension || int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, ErrInvalid
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrInvalid
	}
	// Re-encode decoded pixels: no EXIF, arbitrary chunks, or animation reach the encoder.
	var normalized bytes.Buffer
	if err := png.Encode(&normalized, decoded); err != nil {
		return nil, fmt.Errorf("normalize cover: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	width, height := cfg.Width, cfg.Height
	if width > 1600 || height > 1600 {
		if width >= height {
			height = max(1, height*1600/width)
			width = 1600
		} else {
			width = max(1, width*1600/height)
			height = 1600
		}
	}
	cmd := exec.CommandContext(ctx, "cwebp", "-quiet", "-q", "85", "-metadata", "none", "-resize", strconv.Itoa(width), strconv.Itoa(height), "-o", "-", "--", "-")
	cmd.Stdin = &normalized
	var out limitedBuffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("encode cover: %w", err)
	}
	data = out.Bytes()
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return nil, errors.New("encoder did not produce WebP")
	}
	return data, nil
}

// GameMediaType and GameExtension describe GameImage's output.
const GameMediaType, GameExtension = "image/jpeg", "jpg"

// GameSize is the longest side of a game image.
const GameSize = 512

// GameImage converts Encode's WebP to a small opaque JPEG for the game, which
// decodes only JPEG and PNG. Transparent areas become white.
func GameImage(webp []byte) ([]byte, error) {
	source, _, err := image.Decode(bytes.NewReader(webp))
	if err != nil {
		return nil, fmt.Errorf("decode cover: %w", err)
	}
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	if width > GameSize || height > GameSize {
		if width >= height {
			height = max(1, height*GameSize/width)
			width = GameSize
		} else {
			width = max(1, width*GameSize/height)
			height = GameSize
		}
	}
	scaled := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(scaled, scaled.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), source, source.Bounds(), draw.Over, nil)
	var out bytes.Buffer
	if err = jpeg.Encode(&out, scaled, &jpeg.Options{Quality: 85}); err != nil {
		return nil, fmt.Errorf("encode game cover: %w", err)
	}
	return out.Bytes(), nil
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > MaxBytes {
		return 0, errors.New("encoded cover exceeds limit")
	}
	return b.Buffer.Write(p)
}
