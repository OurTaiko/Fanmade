package tja

import "testing"

// Parse carries each block's raw difficulty constants from TJAParser's notes, for every route.
func TestConstantsForEveryRoute(t *testing.T) {
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
	// Oni: 1 common note and 1 after the branch, with 1, 2 or 4 on the routes.
	want := map[string]map[string]int{"Hard": {"unbranched": 6}, "Oni": {"normal": 3, "expert": 4, "master": 6}}
	for _, d := range m.Difficulties {
		if len(d.Routes) != len(want[d.Course]) {
			t.Fatalf("%s routes %v (is TJAPARSER_BIN a build with route notes?)", d.Course, d.Routes)
		}
		for route, count := range want[d.Course] {
			if d.Routes[route].NoteCount != count || d.Routes[route].Stamina <= 0 {
				t.Errorf("%s %s: %+v, want %d notes", d.Course, route, d.Routes[route], count)
			}
		}
	}
}
