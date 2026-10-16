"use strict";
// Tests for content/static/js/page.js, with fakes for the clock, timers, storage, sound and button.
// Run with: node js_test/page_test.js (the Go test page_js_test.go does).
var assert = require("assert");
var page = require("../content/static/js/page.js");

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

function fakeClock() {
    var c = {time: 1000000, timers: [], nextId: 1};
    c.now = function () { return c.time; };
    c.setTimer = function (fn, ms) { var id = c.nextId++; c.timers.push({id: id, at: c.time + ms, fn: fn}); return id; };
    c.clearTimer = function (id) { c.timers = c.timers.filter(function (t) { return t.id !== id; }); };
    c.advance = function (ms) {
        var end = c.time + ms;
        for (;;) {
            var due = c.timers.filter(function (t) { return t.at <= end; }).sort(function (a, b) { return a.at - b.at; })[0];
            if (!due) { break; }
            c.timers = c.timers.filter(function (t) { return t !== due; });
            c.time = Math.max(c.time, due.at);
            due.fn();
        }
        c.time = end;
    };
    return c;
}

function refreshFixture() {
    var c = fakeClock();
    var reloads = 0;
    var r = new page.RefreshTimer({now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, reload: function () { reloads++; }});
    r.start();
    return {c: c, r: r, reloads: function () { return reloads; }};
}

test("reloads after 30 seconds when untouched", function () {
    var f = refreshFixture();
    f.c.advance(29999);
    assert.strictEqual(f.reloads(), 0);
    f.c.advance(1);
    assert.strictEqual(f.reloads(), 1);
});

test("a touch near the end holds the reload until 10 seconds after it", function () {
    var f = refreshFixture();
    f.c.advance(28000);
    f.r.activity();
    f.c.advance(9999);
    assert.strictEqual(f.reloads(), 0);
    f.c.advance(1);
    assert.strictEqual(f.reloads(), 1);
    assert.strictEqual(f.c.time, 1000000 + 38000);
});

test("a touch early on does not delay the 30 second reload", function () {
    var f = refreshFixture();
    f.c.advance(5000);
    f.r.activity();
    f.c.advance(25000);
    assert.strictEqual(f.reloads(), 1);
});

test("continued touching keeps postponing it", function () {
    var f = refreshFixture();
    for (var i = 0; i < 20; i++) { f.c.advance(5000); f.r.activity(); }
    assert.strictEqual(f.reloads(), 0);
    f.c.advance(10000);
    assert.strictEqual(f.reloads(), 1);
});

test("stop cancels the reload", function () {
    var f = refreshFixture();
    f.r.stop();
    f.c.advance(100000);
    assert.strictEqual(f.reloads(), 0);
});

test("settings fall back to memory when storage throws", function () {
    var broken = {getItem: function () { throw new Error("no"); }, setItem: function () { throw new Error("no"); }};
    var s = new page.Settings(broken);
    assert.strictEqual(s.get("a"), undefined);
    s.set("a", "1");
    assert.strictEqual(s.get("a"), "1");
    var none = new page.Settings(null);
    none.set("b", "2");
    assert.strictEqual(none.get("b"), "2");
});

test("settings persist in storage", function () {
    var data = {};
    var storage = {getItem: function (k) { return k in data ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }};
    new page.Settings(storage).set("k", "v");
    assert.strictEqual(new page.Settings(storage).get("k"), "v");
});

function chimeFixture(opts) {
    opts = opts || {};
    var c = fakeClock();
    var data = opts.data || {};
    var storage = {getItem: function (k) { return k in data ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }};
    var f = {c: c, data: data, plays: 0, renders: [], critical: opts.critical !== false, allow: opts.allow !== false, creates: 0};
    f.sound = {paused: true, currentTime: 0, play: function () {
        f.plays++;
        if (opts.legacy) { if (f.allow) { f.sound.paused = false; } return undefined; }
        return f.allow ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
    }};
    f.chime = new page.Chime({
        now: c.now, settings: new page.Settings(storage), critical: function () { return f.critical; },
        createSound: function () { f.creates++; if (opts.noAudio) { throw new Error("no audio"); } return f.sound; },
        view: {render: function (m) { f.renders.push(m); }}
    });
    f.last = function () { return f.renders[f.renders.length - 1]; };
    return f;
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

test("chimes on load when critical", function () {
    var f = chimeFixture();
    f.chime.start();
    return tick().then(function () {
        assert.strictEqual(f.plays, 1);
        assert.strictEqual(f.last().state, "on");
    });
});

test("does not chime or show a button without a critical alert", function () {
    var f = chimeFixture({critical: false});
    f.chime.start();
    return tick().then(function () {
        assert.strictEqual(f.plays, 0);
        assert.strictEqual(f.creates, 0);
        assert.strictEqual(f.last(), null);
    });
});

test("does not chime again within 50 seconds, does after", function () {
    var data = {};
    var f = chimeFixture({data: data});
    f.chime.start();
    return tick().then(function () {
        var g = chimeFixture({data: data});
        g.c.time = f.c.time + 30000;
        g.chime.start();
        return tick().then(function () {
            assert.strictEqual(g.plays, 0);
            var h = chimeFixture({data: data});
            h.c.time = f.c.time + 50000;
            h.chime.start();
            return tick().then(function () { assert.strictEqual(h.plays, 1); });
        });
    });
});

test("silence persists and stops the chime on the next load", function () {
    var data = {};
    var f = chimeFixture({data: data});
    f.chime.start();
    return tick().then(function () {
        f.chime.toggle();
        assert.strictEqual(f.last().state, "silenced");
        var g = chimeFixture({data: data});
        g.c.time = f.c.time + 60000;
        g.chime.start();
        return tick().then(function () {
            assert.strictEqual(g.plays, 0);
            assert.strictEqual(g.last().state, "silenced");
        });
    });
});

test("pressing a silenced button turns it back on and chimes", function () {
    var f = chimeFixture({data: {"pmaas.chime.silenced": "1"}});
    f.chime.start();
    f.chime.toggle();
    return tick().then(function () {
        assert.strictEqual(f.plays, 1);
        assert.strictEqual(f.last().state, "on");
    });
});

test("a blocked sound shows blocked, then chimes on the next touch", function () {
    var f = chimeFixture({allow: false});
    f.chime.start();
    return tick().then(function () {
        assert.strictEqual(f.last().state, "blocked");
        f.allow = true;
        f.chime.gesture();
        return tick();
    }).then(function () {
        assert.strictEqual(f.plays, 2);
        assert.strictEqual(f.last().state, "on");
    });
});

test("a touch does not chime when silenced or not blocked", function () {
    var f = chimeFixture();
    f.chime.start();
    return tick().then(function () {
        f.c.time += 60000; // a chime would be due, but it isn't blocked, so a touch isn't the way to hear it
        f.chime.gesture();
        assert.strictEqual(f.plays, 1);
    });
});

test("a touch while blocked and silenced stays quiet", function () {
    var f = chimeFixture({allow: false});
    f.chime.start();
    return tick().then(function () {
        f.chime.toggle(); // blocked, so this tries again (still refused)
        return tick();
    }).then(function () {
        f.data["pmaas.chime.silenced"] = "1";
        f.allow = true;
        var before = f.plays;
        f.c.time += 60000;
        f.chime.gesture();
        assert.strictEqual(f.plays, before);
    });
});

test("old browsers whose play() returns nothing are handled", function () {
    var f = chimeFixture({legacy: true});
    f.chime.start();
    assert.strictEqual(f.plays, 1);
    assert.strictEqual(f.last().state, "on");
    var g = chimeFixture({legacy: true, allow: false});
    g.chime.start();
    assert.strictEqual(g.last().state, "blocked");
});

test("no audio support hides the button", function () {
    var f = chimeFixture({noAudio: true});
    f.chime.start();
    assert.strictEqual(f.last(), null);
    f.chime.toggle();
});

test("the wav is a valid 16 bit mono file", function () {
    var b = page.chimeWav();
    var text = function (o, n) { return String.fromCharCode.apply(null, b.slice(o, o + n)); };
    assert.strictEqual(text(0, 4), "RIFF");
    assert.strictEqual(text(8, 4), "WAVE");
    assert.strictEqual(text(36, 4), "data");
    var size = b[40] + b[41] * 256 + b[42] * 65536;
    assert.strictEqual(b.length, 44 + size);
    var peak = 0;
    for (var i = 44; i < b.length; i += 2) {
        var v = b[i] + b[i + 1] * 256; if (v > 32767) { v -= 65536; }
        peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(peak > 3000 && peak < 16000, "soft but audible: " + peak);
    assert.ok(page.chimeUrl(function (s) { return Buffer.from(s, "binary").toString("base64"); }).indexOf("data:audio/wav;base64,UklGR") === 0);
});

function fakeDocument() {
    function el(tag) {
        var e = {tag: tag, children: [], attrs: {}, listeners: {}, parentNode: null, nextSibling: null, className: ""};
        e.appendChild = function (c) { c.parentNode = e; e.children.push(c); return c; };
        e.insertBefore = function (c, ref) { c.parentNode = e; var i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, c); return c; };
        e.removeChild = function (c) { e.children.splice(e.children.indexOf(c), 1); c.parentNode = null; };
        e.setAttribute = function (k, v) { e.attrs[k] = v; };
        e.addEventListener = function (n, fn) { e.listeners[n] = fn; };
        return e;
    }
    return {createElement: el};
}

test("the button is placed after the indicator, updated, and removed", function () {
    var doc = fakeDocument();
    var header = doc.createElement("div");
    var indicator = header.appendChild(doc.createElement("div"));
    var pressed = 0;
    var b = new page.ChimeButton(doc, indicator, function () { pressed++; });
    b.render({state: "on", label: "L"});
    assert.strictEqual(header.children.length, 2);
    assert.strictEqual(header.children[1].className, "chime-toggle");
    assert.strictEqual(header.children[1].attrs["data-state"], "on");
    b.render({state: "blocked", label: "M"});
    assert.strictEqual(header.children.length, 2);
    assert.strictEqual(header.children[1].children[0].className, "bi bi-volume-off-fill");
    header.children[1].listeners.click();
    assert.strictEqual(pressed, 1);
    b.render(null);
    assert.strictEqual(header.children.length, 1);
});

test("listenerOptions falls back to capture where options aren't understood", function () {
    var plain = {addEventListener: function () {}, removeEventListener: function () {}};
    assert.strictEqual(page.listenerOptions(plain), true);
    var modern = {
        addEventListener: function (n, f, o) { void o.passive; },
        removeEventListener: function () {}
    };
    assert.deepStrictEqual(page.listenerOptions(modern), {passive: true, capture: true});
});

test("the script is plain ES5", function () {
    var src = require("fs").readFileSync(require("path").join(__dirname, "../content/static/js/page.js"), "utf8");
    var code = src.split("\n").filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join("\n");
    [/=>/, /\bconst\b/, /\blet\b/, /\basync\b/, /\bawait\b/, /\bclass\s+\w+/, /`/, /\bnew Map\b/, /\.remove\(\)/, /\bSymbol\b/].forEach(function (re) {
        assert.ok(!re.test(code), "uses " + re);
    });
});

var failed = 0;
(function run(i) {
    if (i === tests.length) {
        console.log(failed ? failed + " failed" : "ok (" + tests.length + ")");
        process.exit(failed ? 1 : 0);
    }
    var result;
    try { result = tests[i][1](); } catch (e) { result = Promise.reject(e); }
    Promise.resolve(result).then(function () { run(i + 1); }, function (e) {
        failed++; console.log("FAIL " + tests[i][0] + ": " + (e && e.message)); run(i + 1);
    });
})(0);
