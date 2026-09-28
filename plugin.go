package basicwebui

import (
	"embed"
	"fmt"
	"html/template"
	"net/http"
	"reflect"
	"time"

	"github.com/avanha/pmaas-spi"
)

//go:embed content/static content/templates
var contentFS embed.FS

var ListTemplate = spi.TemplateInfo{
	Name: "layout",
	FuncMap: template.FuncMap{
		"RenderItem": RenderItem,
	},
	Paths:  []string{"templates/layout.htmlt", "templates/entity_list.htmlt"},
	Styles: []string{"css/entity_list.css", "css/nav.css"},
}

// serverStatusTemplate renders the status page's header (uptime/load/memory) - the "other
// stats" that show at the top, above the per-plugin entity list. Registered as the
// EntityRenderer for spi.ServerStatus (see Init), the same way pmaas-plugin-porkbun registers
// one for its own aggregate data.PluginStatus.
var serverStatusTemplate = spi.TemplateInfo{
	Name: "server_status",
	FuncMap: template.FuncMap{
		"FormatUptime": FormatUptime,
		"FormatBytes":  FormatBytes,
	},
	Paths:  []string{"templates/server_status.htmlt"},
	Styles: []string{"css/server_status.css"},
}

// pluginVersionTemplate renders one entity-list row per running plugin - registered as the
// EntityRenderer for spi.PluginVersion (see Init).
var pluginVersionTemplate = spi.TemplateInfo{
	Name:   "plugin_version",
	Paths:  []string{"templates/plugin_version.htmlt"},
	Styles: []string{"css/plugin_version.css"},
}

type state struct {
	container spi.IPMAASContainer
}

type plugin struct {
	state *state
}

type Plugin interface {
	spi.IPMAASPlugin
}

func NewPlugin(_ PluginConfig) Plugin {
	instance := &plugin{
		state: &state{
			container: nil,
		},
	}

	return instance
}

// Implementation of spi.IPMAASRenderPlugin
var _ spi.IPMAASRenderPlugin = (*plugin)(nil)

func (p *plugin) ShortName() string {
	return "basicwebui"
}

func (p *plugin) Init(container spi.IPMAASContainer) {
	p.state.container = container
	container.ProvideContentFS(&contentFS, "content")
	container.EnableStaticContent("static")

	container.RegisterEntityRenderer(
		reflect.TypeOf((*spi.ServerStatus)(nil)).Elem(),
		p.serverStatusRendererFactory)
	container.RegisterEntityRenderer(
		reflect.TypeOf((*spi.PluginVersion)(nil)).Elem(),
		p.pluginVersionRendererFactory)

	// Non-fatal if another plugin already claimed the root status page - this plugin's own
	// server-wide status page is a nice-to-have, not something anything else here depends on.
	if err := container.ProvideRootStatusHandler(p.handleRootStatus); err != nil {
		fmt.Printf("%T unable to register as the root status handler: %v\n", p, err)
	}
}

func (p *plugin) Start() {
	fmt.Printf("%v Starting...\n", *p)
}

func (p *plugin) Stop() chan func() {
	fmt.Printf("%v Stopping...\n", *p)

	return p.state.container.ClosedCallbackChannel()
}

type listData struct {
	CurrentTime time.Time
	Title       string
	TitleSuffix string
	Header      *itemValueAndRenderer
	Items       []*itemValueAndRenderer
	Styles      []string
	Scripts     []string
	Menu        []spi.MenuEntry
	CurrentPath string
}

type itemValueAndRenderer struct {
	Value    any
	Renderer spi.EntityRenderFunc
}

func (i *itemValueAndRenderer) IsPresent() bool {
	return i.Value != nil
}

func RenderItem(item itemValueAndRenderer) (string, error) {
	return item.Renderer(item.Value)
}

type renderContext struct {
	rendererMap map[reflect.Type]spi.EntityRenderer
	styles      []string
	scripts     []string
}

func (c *renderContext) init(compiledTemplate spi.CompiledTemplate) {
	c.rendererMap = make(map[reflect.Type]spi.EntityRenderer)
	c.styles = append(
		make([]string, 0, len(compiledTemplate.Styles)+25),
		compiledTemplate.Styles...)
	c.scripts = append(
		make([]string, 0,
			len(compiledTemplate.Scripts)+25), compiledTemplate.Scripts...)
}

func (c *renderContext) appendStyles(styles []string) {
	c.styles = append(c.styles, styles...)
}

func (c *renderContext) appendScripts(scripts []string) {
	c.scripts = append(c.scripts, scripts...)
}

func (p *plugin) RenderList(
	w http.ResponseWriter, r *http.Request, options spi.RenderListOptions, items []interface{}) {
	currentTime := time.Now()
	compiledTemplate, err := p.state.container.GetTemplate(&ListTemplate)

	if err != nil {
		panic(fmt.Sprintf("Unable to load list template: %v", err))
	}

	ctx := renderContext{}
	ctx.init(compiledTemplate)

	wrappedHeaderItem := itemValueAndRenderer{}

	if options.Header != nil {
		wrappedHeaderItem.Renderer = p.getRenderer(options.Header, &ctx).RenderFunc
		wrappedHeaderItem.Value = options.Header
	}

	wrappedItems := make([]*itemValueAndRenderer, len(items))

	for i, item := range items {
		wrappedItems[i] = &itemValueAndRenderer{
			Value:    item,
			Renderer: p.getRenderer(item, &ctx).RenderFunc,
		}
	}

	data := listData{
		CurrentTime: currentTime,
		Title:       options.Title,
		TitleSuffix: options.TitleSuffix,
		Header:      &wrappedHeaderItem,
		Items:       wrappedItems,
		Styles:      ctx.styles,
		Scripts:     ctx.scripts,
		Menu:        p.state.container.GetMenu(),
		CurrentPath: r.URL.Path,
	}

	if data.Title == "" {
		data.Title = "Entity List"
	}

	err = compiledTemplate.Instance.Execute(w, data)

	if err != nil {
		panic(fmt.Sprintf("Unable to execute list template: %v", err))
	}
}

// handleRootStatus is registered via ProvideRootStatusHandler (see Init) as the server's root
// ("/") page. It renders status the same "header + entity list" way any other plugin's own
// status page does (see e.g. pmaas-plugin-nestthermostat/porkbun's list routes): the
// server-wide stats (uptime/load/memory) as the header, and one entity-list row per plugin -
// calling RenderList directly, rather than via IPMAASContainer.RenderList, since this plugin
// already is the one IPMAASRenderPlugin that call would end up dispatching to.
func (p *plugin) handleRootStatus(w http.ResponseWriter, r *http.Request, status spi.ServerStatus) {
	pluginItems := make([]interface{}, len(status.Plugins))

	for i := range status.Plugins {
		pluginItems[i] = &status.Plugins[i]
	}

	p.RenderList(w, r, spi.RenderListOptions{
		Title:       "PMAAS Status",
		TitleSuffix: assemblyTitleSuffix(status),
		Header:      &status,
	}, pluginItems)
}

// assemblyTitleSuffix renders the running assembly's name/version (e.g.
// "(pmaas-assembly-demo (devel))") for display next to the root status page's title - see
// spi.ServerStatus.AssemblyName/AssemblyVersion and spi.RenderListOptions.TitleSuffix (rendered
// smaller/muted, since this can be an arbitrarily long string). Returns "" when either is empty,
// e.g. a binary built without module build info.
func assemblyTitleSuffix(status spi.ServerStatus) string {
	if status.AssemblyName == "" || status.AssemblyVersion == "" {
		return ""
	}

	return fmt.Sprintf("(%s %s)", status.AssemblyName, status.AssemblyVersion)
}

func (p *plugin) serverStatusRendererFactory() (spi.EntityRenderer, error) {
	return spi.TemplateBasedRendererFactory(
		p.state.container,
		&serverStatusTemplate,
		func(entity any) bool {
			_, ok := entity.(*spi.ServerStatus)
			return ok
		},
		fmt.Sprintf("%T", (*spi.ServerStatus)(nil)))
}

func (p *plugin) pluginVersionRendererFactory() (spi.EntityRenderer, error) {
	return spi.TemplateBasedRendererFactory(
		p.state.container,
		&pluginVersionTemplate,
		func(entity any) bool {
			_, ok := entity.(*spi.PluginVersion)
			return ok
		},
		fmt.Sprintf("%T", (*spi.PluginVersion)(nil)))
}

// FormatUptime renders d the way the server status page wants it: the largest couple of
// non-zero units only (e.g. "3d 4h", not "3d 4h 12m 9s") - exact seconds-level precision on an
// uptime counter isn't useful to a person reading the page.
func FormatUptime(d time.Duration) string {
	d = d.Round(time.Minute)
	days := d / (24 * time.Hour)
	d -= days * 24 * time.Hour
	hours := d / time.Hour
	d -= hours * time.Hour
	minutes := d / time.Minute

	switch {
	case days > 0:
		return fmt.Sprintf("%dd %dh", days, hours)
	case hours > 0:
		return fmt.Sprintf("%dh %dm", hours, minutes)
	default:
		return fmt.Sprintf("%dm", minutes)
	}
}

// FormatBytes renders a byte count in the largest binary unit (KiB/MiB/...) that keeps the
// value at least 1, to one decimal place.
func FormatBytes(b uint64) string {
	const unit = 1024

	if b < unit {
		return fmt.Sprintf("%d B", b)
	}

	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}

	return fmt.Sprintf("%.1f %ciB", float64(b)/float64(div), "KMGTPE"[exp])
}

func (p *plugin) getRenderer(item any, ctx *renderContext) spi.EntityRenderer {
	itemType := reflect.TypeOf(item)

	if itemType.Kind() == reflect.Ptr {
		itemType = reflect.ValueOf(item).Elem().Type()
	}

	renderer, ok := ctx.rendererMap[itemType]

	if !ok {
		var err error
		renderer, err = p.state.container.GetEntityRenderer(itemType)

		if err != nil {
			panic(fmt.Sprintf("unable to get renderer for item type %T: %v", itemType, err))
		}

		ctx.rendererMap[itemType] = renderer
		ctx.appendStyles(renderer.Styles)
		ctx.appendScripts(renderer.Scripts)
	}

	return renderer
}
