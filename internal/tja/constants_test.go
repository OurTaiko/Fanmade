package tja

import "testing"

// Parse carries each block's raw difficulty constants from TJAParser's notes: the master route
// of a branching block.
func TestConstantsFromTheMasterRoute(t *testing.T) {
	if !Available() {
		t.Skip("tjaparser not found: set TJAPARSER_BIN or put it on PATH")
	}
	text := "TITLE:Constants\nBPM:120\nWAVE:a.ogg\n" +
		"COURSE:Hard\nLEVEL:6\n#START\n1020,\n1122,\n#END\n" +
		"COURSE:Oni\nLEVEL:9\n#START\n1000,\n#BRANCHSTART p,80,95\n#N\n1000,\n#E\n2020,\n#M\n3434,\n#BRANCHEND\n1,\n#END\n"
	m, issue := Parse([]byte(text), "utf-8", "a.ogg")
	if issue != nil {
		t.Fatal(issue)
	}
	want := map[string]int{"Hard": 6, "Oni": 6} // Oni: 1 common, 4 on the master route, 1 after
	for _, d := range m.Difficulties {
		if d.Constants == nil {
			t.Fatalf("%s has no constants (is TJAPARSER_BIN a build with route notes?)", d.Course)
		}
		if d.Constants.NoteCount != want[d.Course] {
			t.Errorf("%s note count %d, want %d", d.Course, d.Constants.NoteCount, want[d.Course])
		}
		if d.Constants.Stamina <= 0 {
			t.Errorf("%s stamina %v", d.Course, d.Constants.Stamina)
		}
	}
}
