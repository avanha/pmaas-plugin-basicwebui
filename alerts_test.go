package basicwebui

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"text/template"
	"time"

	"github.com/avanha/pmaas-spi"
	"github.com/avanha/pmaas-spi/alert"
	"github.com/avanha/pmaas-spi/events"
)

func summary(unacknowledged int, worst alert.Severity) alert.SummaryEvent {
	return alert.SummaryEvent{Unacknowledged: unacknowledged, MostSevere: worst}
}

func TestAlertIndicator_ShowsNothingUntilToldOtherwise(t *testing.T) {
	if got := newAlertIndicator().current(); got != nil {
		t.Fatalf("unexpected summary %+v", got)
	}
}

func TestAlertIndicator_ShowsTheLatestSummary(t *testing.T) {
	indicator := newAlertIndicator()
	indicator.apply(summary(3, alert.SeverityCritical))

	if got := indicator.current(); got == nil || got.Count != 3 || got.Worst != alert.SeverityCritical {
		t.Fatalf("unexpected summary %+v", got)
	}

	// The user acknowledged the critical alerts, leaving a warning.
	indicator.apply(summary(1, alert.SeverityWarning))

	if got := indicator.current(); got == nil || got.Count != 1 || got.Worst != alert.SeverityWarning {
		t.Fatalf("unexpected summary %+v", got)
	}
}

func TestAlertIndicator_ClearsWhenNothingNeedsAttention(t *testing.T) {
	indicator := newAlertIndicator()
	indicator.apply(summary(2, alert.SeverityWarning))
	indicator.apply(summary(0, 0))

	if got := indicator.current(); got != nil {
		t.Fatalf("unexpected summary %+v", got)
	}
}

func TestAlertIndicator_IgnoresOtherEvents(t *testing.T) {
	indicator := newAlertIndicator()
	indicator.apply(summary(1, alert.SeverityWarning))
	indicator.apply(alert.RaisedEvent{Source: "a", Key: "1", Severity: alert.SeverityCritical})
	indicator.apply(alert.ClearedEvent{Source: "a", Key: "1"})
	indicator.apply("some other event")
	indicator.apply(nil)

	if got := indicator.current(); got == nil || got.Count != 1 || got.Worst != alert.SeverityWarning {
		t.Fatalf("unexpected summary %+v", got)
	}
}

func TestAlertIndicator_AnUnsetSeverityCountsAsInfo(t *testing.T) {
	indicator := newAlertIndicator()
	indicator.apply(summary(1, 0))

	if got := indicator.current(); got == nil || got.Worst != alert.SeverityInfo || got.Class() != "info" {
		t.Fatalf("unexpected summary %+v", got)
	}
}

func TestAlertSummary_IconClassAndDescription(t *testing.T) {
	for _, c := range []struct {
		summary            alertSummary
		icon, class, descr string
	}{
		{alertSummary{1, alert.SeverityInfo}, "info-circle-fill", "info", "1 unacknowledged alert (info)"},
		{alertSummary{2, alert.SeverityWarning}, "exclamation-triangle-fill", "warning", "2 unacknowledged alerts, most severe: warning"},
		{alertSummary{3, alert.SeverityCritical}, "exclamation-octagon-fill", "critical", "3 unacknowledged alerts, most severe: critical"},
	} {
		if c.summary.Icon() != c.icon || c.summary.Class() != c.class || c.summary.Description() != c.descr {
			t.Errorf("%+v: got %q %q %q", c.summary, c.summary.Icon(), c.summary.Class(), c.summary.Description())
		}
	}
}

// renderLayout renders the real layout with text/template, which is what the core renders with and which does no
// escaping of its own.
func renderLayout(t *testing.T, data listData) string {
	t.Helper()

	source, err := contentFS.ReadFile("content/templates/layout.htmlt")
	if err != nil {
		t.Fatal(err)
	}

	tmpl, err := template.New("layout").Parse(string(source) + `{{define "content"}}{{end}}`)
	if err != nil {
		t.Fatal(err)
	}

	var out strings.Builder
	if err := tmpl.ExecuteTemplate(&out, "layout", data); err != nil {
		t.Fatal(err)
	}

	return out.String()
}

func TestLayout_ShowsNoIndicatorWithoutAlerts(t *testing.T) {
	out := renderLayout(t, listData{CurrentTime: time.Now(), Title: "Page"})

	if strings.Contains(out, "alert-indicator") {
		t.Fatalf("unexpected indicator:\n%s", out)
	}
}

func TestLayout_ShowsTheMostSevereLevelBeforeTheTime(t *testing.T) {
	out := renderLayout(t, listData{
		CurrentTime: time.Now(), Title: "Page", Alerts: &alertSummary{Count: 2, Worst: alert.SeverityCritical},
	})

	for _, want := range []string{
		`class="alert-indicator critical"`, `bi-exclamation-octagon-fill`, `2 unacknowledged alerts, most severe: critical`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}

	if strings.Index(out, "alert-indicator") > strings.Index(out, `class="timestamp"`) {
		t.Errorf("the indicator should come before (left of) the time:\n%s", out)
	}
}

// fakeContainer implements only what the plugin's alert handling uses.
type fakeContainer struct {
	spi.IPMAASContainer

	predicate     events.EventPredicate
	receiver      events.EventReceiver
	registerErr   error
	deregistered  []int
	closedChannel chan func()
}

func (c *fakeContainer) RegisterEventReceiver(p events.EventPredicate, r events.EventReceiver) (int, error) {
	if c.registerErr != nil {
		return 0, c.registerErr
	}

	c.predicate, c.receiver = p, r

	return 7, nil
}

func (c *fakeContainer) DeregisterEventReceiver(handle int) error {
	c.deregistered = append(c.deregistered, handle)

	return nil
}

func (c *fakeContainer) GetMenu() []spi.MenuEntry { return nil }

func (c *fakeContainer) GetTemplate(info *spi.TemplateInfo) (spi.CompiledTemplate, error) {
	source, err := contentFS.ReadFile("content/templates/layout.htmlt")
	if err != nil {
		return spi.CompiledTemplate{}, err
	}

	// The real template engine parses the same files; the entity list is stubbed out, since only the layout
	// is under test.
	tmpl, err := template.New(info.Name).Parse(string(source) + `{{define "content"}}{{end}}`)
	if err != nil {
		return spi.CompiledTemplate{}, err
	}

	return spi.CompiledTemplate{Instance: tmpl.Lookup(info.Name)}, nil
}

func (c *fakeContainer) ClosedCallbackChannel() chan func() { return c.closedChannel }

func TestPlugin_FollowsAlertSummariesBetweenStartAndStop(t *testing.T) {
	container := &fakeContainer{closedChannel: make(chan func())}
	p := NewPlugin(NewPluginConfig()).(*plugin)
	p.state.container = container

	p.Start()

	if container.receiver == nil || !container.predicate(&events.EventInfo{Event: summary(1, alert.SeverityInfo)}) ||
		container.predicate(&events.EventInfo{Event: alert.RaisedEvent{}}) || container.predicate(&events.EventInfo{Event: "other"}) {
		t.Fatal("expected a receiver for alert summaries only")
	}

	if err := container.receiver(&events.EventInfo{Event: summary(1, alert.SeverityWarning)}); err != nil {
		t.Fatal(err)
	}

	if s := p.state.alerts.current(); s == nil || s.Worst != alert.SeverityWarning {
		t.Fatalf("unexpected summary %+v", s)
	}

	_ = p.Stop()
	_ = p.Stop() // stopping twice must not deregister twice

	if len(container.deregistered) != 1 || container.deregistered[0] != 7 {
		t.Fatalf("unexpected deregistrations %v", container.deregistered)
	}
}

func TestPlugin_StartSurvivesNotBeingAbleToRegister(t *testing.T) {
	container := &fakeContainer{registerErr: errors.New("nope"), closedChannel: make(chan func())}
	p := NewPlugin(NewPluginConfig()).(*plugin)
	p.state.container = container

	p.Start()
	_ = p.Stop()

	if len(container.deregistered) != 0 {
		t.Fatalf("deregistered a receiver that was never registered: %v", container.deregistered)
	}
}

func TestRenderList_ShowsTheConsolesSummaryInTheHeader(t *testing.T) {
	container := &fakeContainer{closedChannel: make(chan func())}
	p := NewPlugin(NewPluginConfig()).(*plugin)
	p.state.container = container

	render := func() string {
		recorder := httptest.NewRecorder()
		p.RenderList(recorder, httptest.NewRequest("GET", "/", nil), spi.RenderListOptions{Title: "Page"}, nil)

		return recorder.Body.String()
	}

	if out := render(); strings.Contains(out, "alert-indicator") {
		t.Fatalf("indicator shown with no alerts:\n%s", out)
	}

	p.state.alerts.apply(summary(1, alert.SeverityWarning))

	if out := render(); !strings.Contains(out, "alert-indicator warning") {
		t.Fatalf("expected the warning indicator:\n%s", out)
	}

	p.state.alerts.apply(summary(0, 0)) // the user acknowledged it

	if out := render(); strings.Contains(out, "alert-indicator") {
		t.Fatalf("indicator still shown after the user acknowledged the alert:\n%s", out)
	}
}
