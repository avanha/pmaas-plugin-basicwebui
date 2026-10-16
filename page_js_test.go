package basicwebui

import (
	"os/exec"
	"strings"
	"testing"
)

// The page's script (reload when idle, the critical-alert chime) is tested in node, with fakes for the clock, storage
// and sound. Skipped where node isn't installed.
func TestPageScript(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node isn't installed")
	}

	out, err := exec.Command(node, "js_test/page_test.js").CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
}

func TestLayout_RefreshesWithoutScriptOnlyInNoscript(t *testing.T) {
	out := renderLayout(t, listData{Title: "Page"})

	if !strings.Contains(out, `<noscript><meta http-equiv="refresh" content="30"></noscript>`) {
		t.Fatalf("the refresh should be a fallback for when scripts are off:\n%s", out)
	}

	if strings.Count(out, "http-equiv=\"refresh\"") != 1 {
		t.Fatalf("expected a single refresh:\n%s", out)
	}
}

func TestLayout_IncludesTheScripts(t *testing.T) {
	out := renderLayout(t, listData{Title: "Page", Scripts: ListTemplate.Scripts})

	if !strings.Contains(out, `<script src="js/page.js" defer></script>`) {
		t.Fatalf("the page script isn't included:\n%s", out)
	}
}

func TestListTemplate_ServesItsScripts(t *testing.T) {
	if len(ListTemplate.Scripts) == 0 {
		t.Fatal("no scripts")
	}

	for _, script := range ListTemplate.Scripts {
		if _, err := contentFS.ReadFile("content/static/" + script); err != nil {
			t.Errorf("%s: %v", script, err)
		}
	}
}
