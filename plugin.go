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
	Name: "entity_list",
	FuncMap: template.FuncMap{
		"RenderItem": RenderItem,
	},
	Paths:  []string{"templates/entity_list.htmlt"},
	Styles: []string{"css/entity_list.css"},
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

func (p *plugin) Init(container spi.IPMAASContainer) {
	p.state.container = container
	container.ProvideContentFS(&contentFS, "content")
	container.EnableStaticContent("static")
}

func (p *plugin) Start() {
	fmt.Printf("%v Starting...\n", *p)
}

func (p *plugin) Stop() {
	fmt.Printf("%v Stopping...\n", *p)
}

type listData struct {
	CurrentTime time.Time
	Title       string
	Header      *itemValueAndRenderer
	Items       []*itemValueAndRenderer
	Styles      []string
	Scripts     []string
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
	w http.ResponseWriter, _ *http.Request, options spi.RenderListOptions, items []interface{}) {
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
		Header:      &wrappedHeaderItem,
		Items:       wrappedItems,
		Styles:      ctx.styles,
		Scripts:     ctx.scripts,
	}

	if data.Title == "" {
		data.Title = "Entity List"
	}

	err = compiledTemplate.Instance.Execute(w, data)

	if err != nil {
		panic(fmt.Sprintf("Unable to execute list template: %v", err))
	}
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
