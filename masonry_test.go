package basicwebui

import (
	"html/template"
	"os"
	"strings"
	"testing"
)

func renderContent(t *testing.T, masonry bool) string {
	t.Helper()

	tmpl, err := template.New("").Funcs(template.FuncMap{"RenderItem": func(any) string { return "item" }}).
		ParseFS(contentFS, "content/templates/entity_list.htmlt")
	if err != nil {
		t.Fatal(err)
	}

	var out strings.Builder

	err = tmpl.ExecuteTemplate(&out, "content", map[string]any{
		"Header": struct{ IsPresent bool }{false}, "Items": []int{1, 2}, "Masonry": masonry,
	})
	if err != nil {
		t.Fatal(err)
	}

	return out.String()
}

func TestEntityList_OnlyAPageThatAsksForMasonryGetsIt(t *testing.T) {
	if got := renderContent(t, true); !strings.Contains(got, `<ol class="entity-list masonry">`) {
		t.Errorf("asked for masonry:\n%s", got)
	}

	if got := renderContent(t, false); !strings.Contains(got, `<ol class="entity-list">`) || strings.Contains(got, "masonry") {
		t.Errorf("not asked for:\n%s", got)
	}
}

// The masonry rules are for the browsers that have it. Outside @supports they would break the layout of every other browser, which
// keeps the wrapping rows (an old iPad's Safari has no grid at all).
func TestEntityListCss_MasonryIsOnlyForBrowsersThatHaveIt(t *testing.T) {
	css, err := os.ReadFile("content/static/css/entity_list.css")
	if err != nil {
		t.Fatal(err)
	}

	text := string(css)
	at := strings.Index(text, "@supports (display: grid-lanes)")

	if at < 0 {
		t.Fatal("no @supports for grid lanes")
	}

	if before := text[:at]; strings.Contains(before, "masonry") && strings.Contains(before[strings.LastIndex(before, "*/")+2:], "masonry") {
		t.Errorf("masonry rules outside @supports")
	}

	inside := text[at:]
	for _, want := range []string{"display: grid-lanes", "ol.entity-list.masonry", "grid-template-columns"} {
		if !strings.Contains(inside, want) {
			t.Errorf("missing %q inside @supports", want)
		}
	}

	// The fallback is what it was: wrapping rows of fixed-width cards.
	for _, want := range []string{"display: flex;", "flex-flow: row wrap;", "width: 480px;"} {
		if !strings.Contains(text[:at], want) {
			t.Errorf("the fallback lost %q", want)
		}
	}
}
