package basicwebui

import (
	"bytes"
	"html/template"
	"log/slog"
	"strings"
	"testing"

	"github.com/avanha/pmaas-spi/logging"
)

type fakeController struct {
	components []logging.Component
	set        map[string]slog.Level
	cleared    []string
	err        error
}

func (f *fakeController) Components() []logging.Component { return f.components }

func (f *fakeController) SetLevel(name string, level slog.Level) error {
	if f.set == nil {
		f.set = map[string]slog.Level{}
	}

	f.set[name] = level

	return f.err
}

func (f *fakeController) ClearLevel(name string) error {
	f.cleared = append(f.cleared, name)

	return f.err
}

func TestParseLevel(t *testing.T) {
	for name, want := range map[string]slog.Level{
		"DEBUG": slog.LevelDebug, "info": slog.LevelInfo, "Warn": slog.LevelWarn, "ERROR": slog.LevelError,
	} {
		if got, err := parseLevel(name); err != nil || got != want {
			t.Errorf("%s: %v %v", name, got, err)
		}
	}

	for _, bad := range []string{"", "TRACE", "WARN+1", "INFO+2"} {
		if _, err := parseLevel(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestChangeLevel(t *testing.T) {
	c := &fakeController{}

	if err := changeLevel(c, &loggingLevelRequest{Component: "plugin.x", Level: "debug"}); err != nil || c.set["plugin.x"] != slog.LevelDebug {
		t.Errorf("set: %v %v", err, c.set)
	}

	if err := changeLevel(c, &loggingLevelRequest{Component: "", Level: "ERROR"}); err != nil || c.set[""] != slog.LevelError {
		t.Errorf("default: %v %v", err, c.set)
	}

	if err := changeLevel(c, &loggingLevelRequest{Component: "plugin.x"}); err != nil || len(c.cleared) != 1 || c.cleared[0] != "plugin.x" {
		t.Errorf("clear: %v %v", err, c.cleared)
	}

	if changeLevel(c, &loggingLevelRequest{}) == nil {
		t.Error("the default was taken away")
	}

	if changeLevel(c, &loggingLevelRequest{Component: "a", Level: "LOUD"}) == nil {
		t.Error("a bad level was accepted")
	}

	if len(c.set) != 2 || len(c.cleared) != 1 {
		t.Errorf("the refused requests changed something: %v %v", c.set, c.cleared)
	}
}

func TestLoggingLevelsOf_RowsInTheOrderGivenWithLabelsAndDepth(t *testing.T) {
	page := loggingLevelsOf(&fakeController{components: []logging.Component{
		{Name: "", Level: slog.LevelWarn, Set: true},
		{Name: "plugin", Level: slog.LevelInfo, Set: true},
		{Name: "plugin.esphome.broker", Level: slog.LevelInfo},
	}})

	if len(page.Rows) != 3 {
		t.Fatalf("%+v", page.Rows)
	}

	want := []loggingRow{
		{Name: "", Label: "All components", Depth: 0, Level: "WARN", Set: true},
		{Name: "plugin", Label: "plugin", Depth: 1, Level: "INFO", Set: true},
		{Name: "plugin.esphome.broker", Label: "broker", Depth: 3, Level: "INFO"},
	}

	for i := range want {
		if page.Rows[i] != want[i] {
			t.Errorf("row %d: %+v, want %+v", i, page.Rows[i], want[i])
		}
	}

	if got := loggingLevelsOf(nil); got.Unavailable == "" || len(got.Rows) != 0 {
		t.Errorf("without a controller: %+v", got)
	}
}

func renderLogging(t *testing.T, page loggingLevels) string {
	t.Helper()

	tmpl, err := template.ParseFS(contentFS, "content/templates/logging_levels.htmlt")
	if err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	if err := tmpl.Execute(&out, &page); err != nil {
		t.Fatal(err)
	}

	return out.String()
}

func TestLoggingTemplate_SelectsTheLevelSetAndOffersInheritOnlyBelowTheDefault(t *testing.T) {
	out := renderLogging(t, loggingLevelsOf(&fakeController{components: []logging.Component{
		{Name: "", Level: slog.LevelWarn, Set: true},
		{Name: "core", Level: slog.LevelDebug, Set: true},
		{Name: "core.eventmanager", Level: slog.LevelDebug},
	}}))

	rows := strings.Split(out, `<tr class=`)[1:]
	if len(rows) != 3 {
		t.Fatalf("%d rows:\n%s", len(rows), out)
	}

	if strings.Contains(rows[0], `value=""`) || !strings.Contains(rows[0], `<option value="WARN" selected>`) {
		t.Errorf("default row:\n%s", rows[0])
	}

	if !strings.Contains(rows[1], `<option value="DEBUG" selected>`) || strings.Contains(rows[1], `value="" selected`) {
		t.Errorf("a component with a level of its own:\n%s", rows[1])
	}

	if !strings.Contains(rows[2], `value="" selected>inherit (DEBUG)`) || strings.Contains(rows[2], `value="DEBUG" selected`) {
		t.Errorf("an inheriting component:\n%s", rows[2])
	}

	if !strings.Contains(rows[2], `data-component="core.eventmanager"`) || !strings.Contains(rows[2], "inherited") {
		t.Errorf("an inheriting component's row:\n%s", rows[2])
	}
}

func TestLoggingTemplate_SaysSoWhenThereIsNothingToChange(t *testing.T) {
	out := renderLogging(t, loggingLevelsOf(nil))

	if !strings.Contains(out, "does not offer control") || strings.Contains(out, "<select") {
		t.Error(out)
	}
}
