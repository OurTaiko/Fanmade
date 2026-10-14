package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/tja"
)

// Keep the first occurrence in block order, so credits never shuffle between reads.
func difficultyMakers(difficulties []tja.Difficulty) string {
	seen := map[string]bool{}
	names := []string{}
	for _, d := range difficulties {
		name := strings.TrimSpace(d.Maker)
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return strings.Join(names, " | ")
}

// The client identifies blocks, but cannot change their server-parsed difficulty.
func applyDifficultyMakers(raw string, difficulties []tja.Difficulty) error {
	if raw == "" {
		return nil
	}
	var entries []struct {
		Course string  `json:"course"`
		Side   string  `json:"side"`
		Maker  *string `json:"maker"`
	}
	if !utf8.ValidString(raw) || json.Unmarshal([]byte(raw), &entries) != nil || len(entries) != len(difficulties) {
		return fmt.Errorf("请为每个谱面块提供对应的制作者")
	}
	names := make(map[[2]string]string, len(entries))
	for _, entry := range entries {
		if entry.Course == "" || entry.Side == "" || entry.Maker == nil {
			return fmt.Errorf("制作者对应的谱面块无效")
		}
		slot := [2]string{entry.Course, entry.Side}
		if _, exists := names[slot]; exists {
			return fmt.Errorf("制作者对应的谱面块重复")
		}
		name := strings.TrimSpace(*entry.Maker)
		if len(name) > 500 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
			return fmt.Errorf("制作者名不能超过 500 字节或包含控制字符")
		}
		names[slot] = name
	}
	for i := range difficulties {
		name, exists := names[[2]string{difficulties[i].Course, difficulties[i].Side}]
		if !exists {
			return fmt.Errorf("制作者对应的难度无效")
		}
		difficulties[i].Maker = name
	}
	return nil
}

// chartDifficulties reads a chart's blocks in the order the API lists them.
func chartDifficulties(ctx context.Context, tx pgx.Tx, chartID string) ([]tja.Difficulty, error) {
	rows, err := tx.Query(ctx, `SELECT d.id,d.course,d.side,d.level,d.maker,d.branching FROM chart_difficulties d WHERE d.chart_id=$1 ORDER BY `+slotOrder, chartID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (tja.Difficulty, error) {
		var d tja.Difficulty
		return d, row.Scan(&d.ID, &d.Course, &d.Side, &d.Level, &d.Maker, &d.Branching)
	})
}

// setDifficulties makes chart_difficulties hold exactly the given blocks of a
// chart. A slot that remains keeps its row, and with it the ID scores refer
// to. A slot the new file no longer has is removed with its scores, whose
// request keys are kept so a retried submission is not stored again.
func setDifficulties(ctx context.Context, tx pgx.Tx, chartID string, blocks []tja.Difficulty) error {
	stored, err := chartDifficulties(ctx, tx, chartID)
	if err != nil {
		return err
	}
	wanted := map[[2]string]bool{}
	for _, d := range blocks {
		wanted[[2]string{d.Course, d.Side}] = true
	}
	for _, d := range stored {
		if wanted[[2]string{d.Course, d.Side}] {
			continue
		}
		if _, err = tx.Exec(ctx, `INSERT INTO retired_score_requests(user_id,idempotency_key) SELECT user_id,idempotency_key FROM scores WHERE difficulty_id=$1 AND idempotency_key IS NOT NULL ON CONFLICT DO NOTHING`, d.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM scores WHERE difficulty_id=$1`, d.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM chart_difficulties WHERE id=$1`, d.ID); err != nil {
			return err
		}
	}
	for _, d := range blocks {
		if _, err = tx.Exec(ctx, `INSERT INTO chart_difficulties(chart_id,course,side,level,maker,branching) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(chart_id,course,side) DO UPDATE SET level=EXCLUDED.level,maker=EXCLUDED.maker,branching=EXCLUDED.branching`,
			chartID, d.Course, d.Side, d.Level, d.Maker, d.Branching); err != nil {
			return err
		}
	}
	return nil
}
