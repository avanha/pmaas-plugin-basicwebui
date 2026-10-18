package basicwebui

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/avanha/pmaas-spi"
	"github.com/avanha/pmaas-spi/logging"
)

// loggingTemplate renders the page that sets how much each component of the server logs.
var loggingTemplate = spi.TemplateInfo{
	Name:    "logging_levels",
	Paths:   []string{"templates/logging_levels.htmlt"},
	Styles:  []string{"css/logging_levels.css"},
	Scripts: []string{"js/logging_levels.js"},
}

// loggingLevelNames are the levels that can be chosen, most detailed first, as the page and the JSON route name them.
var loggingLevelNames = []string{"DEBUG", "INFO", "WARN", "ERROR"}

// loggingLevels is the page: one row per component, and the default above them all.
type loggingLevels struct {
	Rows   []loggingRow
	Levels []string

	// Unavailable is why there is nothing to change, if there is not.
	Unavailable string
}

type loggingRow struct {
	// Name is the component's full name, which the route is given; Label is its last part, shown indented by Depth.
	Name  string
	Label string
	Depth int

	// Level is the level in force, and Set is whether it was chosen for this component rather than inherited.
	Level string
	Set   bool
}

func levelName(level slog.Level) string {
	return level.String()
}

func parseLevel(name string) (slog.Level, error) {
	for _, candidate := range loggingLevelNames {
		if strings.EqualFold(name, candidate) {
			var level slog.Level
			err := level.UnmarshalText([]byte(candidate))

			return level, err
		}
	}

	return 0, fmt.Errorf("%q is not a level", name)
}

func loggingLevelsOf(controller logging.Controller) loggingLevels {
	page := loggingLevels{Levels: loggingLevelNames}

	if controller == nil {
		page.Unavailable = "This server does not offer control of its logging."

		return page
	}

	for _, component := range controller.Components() {
		label := "All components"

		if component.Name != "" {
			label = component.Name[strings.LastIndexByte(component.Name, '.')+1:]
		}

		page.Rows = append(page.Rows, loggingRow{
			Name:  component.Name,
			Label: label,
			Depth: logging.Depth(component.Name),
			Level: levelName(component.Level),
			Set:   component.Set,
		})
	}

	return page
}

func (p *plugin) handleLogging(w http.ResponseWriter, r *http.Request) {
	page := loggingLevelsOf(logging.ControllerOf(p.state.container))

	p.RenderList(w, r, spi.RenderListOptions{Title: "Logging"}, []any{&page})
}

type loggingLevelRequest struct {
	// Component is the component's name, or empty for the default.
	Component string

	// Level is DEBUG, INFO, WARN or ERROR; or empty to take away a component's own level, so that it inherits one.
	Level string
}

type loggingLevelResponse struct {
	OK bool
}

func (p *plugin) handleLoggingLevel(_ http.ResponseWriter, r *http.Request, request any) (any, error) {
	if r.Method != http.MethodPost {
		return nil, errors.New("method not allowed")
	}

	body, ok := request.(*loggingLevelRequest)
	if !ok {
		return nil, errors.New("a component and a level are required")
	}

	controller := logging.ControllerOf(p.state.container)
	if controller == nil {
		return nil, errors.New("this server does not offer control of its logging")
	}

	if err := changeLevel(controller, body); err != nil {
		return nil, err
	}

	return loggingLevelResponse{OK: true}, nil
}

func changeLevel(controller logging.Controller, request *loggingLevelRequest) error {
	if request.Level == "" {
		if request.Component == "" {
			return errors.New("the default can't be taken away, only changed")
		}

		return controller.ClearLevel(request.Component)
	}

	level, err := parseLevel(request.Level)
	if err != nil {
		return err
	}

	return controller.SetLevel(request.Component, level)
}

func (p *plugin) loggingLevelsRendererFactory() (spi.EntityRenderer, error) {
	return spi.TemplateBasedRendererFactory(
		p.state.container,
		&loggingTemplate,
		func(entity any) bool {
			_, ok := entity.(*loggingLevels)
			return ok
		},
		fmt.Sprintf("%T", (*loggingLevels)(nil)))
}
