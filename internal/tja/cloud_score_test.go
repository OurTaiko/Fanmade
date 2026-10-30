package tja

import "testing"

func TestChartSlots(t *testing.T) {
	const header = "TITLE:Test\nBPM:120\nWAVE:music.ogg\nCOURSE:Oni\nLEVEL:5\n"
	const single = "#START\n1000,\n#END\n"
	const p1 = "#START P1\n1000,\n#END\n"
	const p2 = "#START P2\n2000,\n#END\n"
	for _, tc := range []struct {
		name, body string
		slots      []string
		errorCode  string
	}{
		{"implicit single", single, []string{"Oni single"}, ""},
		{"explicit single", "STYLE:0\n" + single, []string{"Oni single"}, ""},
		{"double players", "STYLE:Double\n" + p1 + p2, []string{"Oni p1", "Oni p2"}, ""},
		{"implicit double", p2 + p1, []string{"Oni p2", "Oni p1"}, ""},
		{"duet alias", "STYLE:Duet\n" + p1 + p2, []string{"Oni p1", "Oni p2"}, ""},
		{"no side", "STYLE:Double\n" + single, nil, "TJA_PLAYER_REQUIRED"},
		{"all three", single + p1 + p2, []string{"Oni single", "Oni p1", "Oni p2"}, ""},
		{"sides per course", p1 + "COURSE:Hard\nLEVEL:4\n" + single, []string{"Oni p1", "Hard single"}, ""},
		{"duplicate single", single + single, nil, "TJA_DIFFICULTY_DUPLICATE"},
		{"duplicate side", p1 + p1, nil, "TJA_DIFFICULTY_DUPLICATE"},
		{"invalid style", "STYLE:Unknown\n" + single, nil, "TJA_STRUCTURE_INVALID"},
		{"style in block", "#START\nSTYLE:Double\n1000,\n#END\n", nil, "TJA_STRUCTURE_INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, issue := Parse([]byte(header+tc.body), "music.ogg")
			if tc.errorCode != "" {
				if issue == nil || issue.Code != tc.errorCode || issue.Line == 0 {
					t.Fatalf("expected %s, got %v", tc.errorCode, issue)
				}
				return
			}
			if issue != nil || len(m.Difficulties) != len(tc.slots) {
				t.Fatalf("%+v %v", m, issue)
			}
			for i, d := range m.Difficulties {
				if d.Course+" "+d.Side != tc.slots[i] {
					t.Fatal(m.Difficulties)
				}
			}
		})
	}
}
