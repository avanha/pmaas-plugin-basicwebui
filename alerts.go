package basicwebui

import (
	"fmt"
	"sync"

	"github.com/avanha/pmaas-spi/alert"
)

// alertIndicator holds what the page header shows about alerts: the latest SummaryEvent from the alert console.
// The console owns the alerts, including which the user has acknowledged and the rule that an escalation needs
// the user's attention again, so this takes its word for it rather than keeping a copy of the rules. Without a
// console in the assembly nothing is published, and the header shows nothing.
//
// Events arrive on the plugin goroutine and pages are rendered on HTTP goroutines, so it has its own lock.
type alertIndicator struct {
	mu      sync.Mutex
	summary *alertSummary
}

func newAlertIndicator() *alertIndicator {
	return &alertIndicator{}
}

// apply takes in a summary event, and ignores anything else.
func (i *alertIndicator) apply(event any) {
	summary, ok := event.(alert.SummaryEvent)
	if !ok {
		return
	}

	i.mu.Lock()
	defer i.mu.Unlock()

	if summary.Unacknowledged <= 0 {
		i.summary = nil

		return
	}

	i.summary = &alertSummary{Count: summary.Unacknowledged, Worst: summary.MostSevere.Normalize()}
}

// current returns what the header shows, or nil when nothing needs the user's attention.
func (i *alertIndicator) current() *alertSummary {
	i.mu.Lock()
	defer i.mu.Unlock()

	return i.summary
}

// alertSummary is the alerts that still need attention, as far as the page header is concerned. It is never
// modified once made.
type alertSummary struct {
	Count int
	Worst alert.Severity
}

// Class is the CSS class that colors the indicator: "info", "warning" or "critical".
func (s *alertSummary) Class() string {
	return s.Worst.String()
}

// Icon is the Bootstrap Icons name for the most severe alert's level.
func (s *alertSummary) Icon() string {
	switch s.Worst {
	case alert.SeverityCritical:
		return "exclamation-octagon-fill"
	case alert.SeverityWarning:
		return "exclamation-triangle-fill"
	default:
		return "info-circle-fill"
	}
}

// Description is the tooltip, and the text a screen reader gets in place of the icon.
func (s *alertSummary) Description() string {
	if s.Count == 1 {
		return fmt.Sprintf("1 unacknowledged alert (%s)", s.Class())
	}

	return fmt.Sprintf("%d unacknowledged alerts, most severe: %s", s.Count, s.Class())
}
