package tja

import (
	"bytes"
	"unicode/utf8"
)

// NormalizeUTF8 checks that a TJA is UTF-8 and returns it without a BOM. The site takes
// UTF-8 only: the browser converts other encodings before it uploads a file.
func NormalizeUTF8(data []byte) ([]byte, *Issue) {
	if len(data) == 0 || len(data) > MaxTJA {
		return nil, fail("FILE_SIZE_INVALID", "TJA 不能为空且不能超过 2 MiB", 0)
	}
	if !utf8.Valid(data) {
		return nil, fail("TJA_ENCODING_INVALID", "TJA 不是有效 UTF-8，请转存为 UTF-8 后重新上传", 0)
	}
	if bytes.Contains(data, []byte("\uFFFD")) || bytes.IndexByte(data, 0) >= 0 {
		return nil, fail("TJA_ENCODING_INVALID", "文本包含无法识别或损坏的字符", 0)
	}
	data = bytes.TrimPrefix(data, []byte("\uFEFF"))
	if len(data) == 0 {
		return nil, fail("FILE_SIZE_INVALID", "TJA 不能为空且不能超过 2 MiB", 0)
	}
	return data, nil
}
