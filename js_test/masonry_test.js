"use strict";
// Tests for content/static/js/masonry.js: the placing is a function of sizes and a width, and the rest is given its browser.
// Run with: node js_test/masonry_test.js (the Go test page_js_test.go does).
var assert = require("assert");
var masonry = require("../content/static/js/masonry.js");

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

function card(height, width) { return {width: width || 480, height: height}; }

test("the first row fills left to right", function () {
    var r = masonry.place([card(100), card(100), card(100)], 1500, 10, 16);
    assert.strictEqual(r.columns, 3);
    assert.deepStrictEqual(r.positions.map(function (p) { return p.left; }), [0, 490, 980]);
    assert.deepStrictEqual(r.positions.map(function (p) { return p.top; }), [0, 0, 0]);
});

test("a card goes into the shortest column", function () {
    // Heights 300, 100, 200 across, so the tops are 310, 110 and 210; the fourth goes under the 100.
    var r = masonry.place([card(300), card(100), card(200), card(50), card(50)], 1500, 10, 0);
    assert.strictEqual(r.positions[3].left, 490);
    assert.strictEqual(r.positions[3].top, 110);
    // The second column is now at 170, still shorter than the third at 210 and the first at 310.
    assert.strictEqual(r.positions[4].left, 490);
    assert.strictEqual(r.positions[4].top, 170);
});

test("columns that are nearly level go left to right, not to whichever is a few pixels shorter", function () {
    // The second column is 5px shorter than the first, within the tolerance: the next card goes in the first.
    var r = masonry.place([card(100), card(95), card(10)], 980, 10, 16);
    assert.strictEqual(r.positions[2].left, 0);
    // With no tolerance it goes to the shorter.
    r = masonry.place([card(100), card(95), card(10)], 980, 10, 0);
    assert.strictEqual(r.positions[2].left, 490);
});

test("as many columns as fit, and at least one", function () {
    // Two cards and the gap between them need 970.
    assert.strictEqual(masonry.place([card(10)], 969, 10, 16).columns, 1);
    assert.strictEqual(masonry.place([card(10)], 970, 10, 16).columns, 2);
    assert.strictEqual(masonry.place([card(10)], 100, 10, 16).columns, 1);
    assert.strictEqual(masonry.place([card(10)], 0, 10, 16).columns, 1);
});

test("the height is the tallest column without the gap after it", function () {
    var r = masonry.place([card(100), card(50), card(100)], 980, 10, 0);
    // Columns: 100 then +100 under the 50? The third goes under the second (shortest): 50+10+100 = 160; the first is 100.
    assert.strictEqual(r.height, 160);
    assert.strictEqual(masonry.place([], 1000, 10, 16).height, 0);
});

test("one column stacks them in order", function () {
    var r = masonry.place([card(10), card(20), card(30)], 480, 10, 16);
    assert.deepStrictEqual(r.positions.map(function (p) { return p.top; }), [0, 20, 50]);
    assert.strictEqual(r.height, 80); // 10 + 20 + 30 and two gaps, none after the last
});

test("cards of different widths use the widest as the column", function () {
    var r = masonry.place([card(10, 300), card(10, 480), card(10, 100)], 980, 10, 16);
    assert.strictEqual(r.columns, 2);
    assert.strictEqual(r.positions[1].left, 490);
});

function fakeEnv(opts) {
    var moved = [];
    var list = {className: "entity-list masonry", style: {}};
    var cards = (opts.heights || []).map(function (h, i) { return {id: i, height: h}; });
    return {
        moved: moved,
        list: list,
        nativeMasonry: function () { return !!opts.native; },
        cards: function () { return cards; },
        size: function (c) { return {width: 480, height: c.height}; },
        width: function () { return opts.width || 1500; },
        move: function (c, l, t) { moved.push([c.id, l, t]); },
        setHeight: function (target, h) { target.style.height = h + "px"; }
    };
}

test("a browser that has masonry is left alone", function () {
    var env = fakeEnv({native: true, heights: [100, 200]});
    assert.strictEqual(masonry.layOut(env), false);
    assert.strictEqual(env.list.className, "entity-list masonry");
    assert.deepStrictEqual(env.moved, []);
    assert.strictEqual(env.list.style.height, undefined);
});

test("elsewhere the list is marked, the cards moved and the list given its height", function () {
    var env = fakeEnv({heights: [100, 200, 50]});
    assert.strictEqual(masonry.layOut(env), true);
    assert.ok(env.list.className.indexOf("masonry-js") >= 0);
    assert.deepStrictEqual(env.moved, [[0, 0, 0], [1, 490, 0], [2, 980, 0]]);
    assert.strictEqual(env.list.style.height, "200px");
});

test("doing it again does not mark the list twice", function () {
    var env = fakeEnv({heights: [100]});
    masonry.layOut(env);
    masonry.layOut(env);
    assert.strictEqual(env.list.className.split("masonry-js").length, 2);
});

test("start does nothing on a page without a masonry list", function () {
    var doc = {querySelector: function () { return null; }};
    assert.strictEqual(masonry.start(doc, {}), null);
});

function fakeWindow(opts) {
    var listeners = {};
    return {
        listeners: listeners,
        CSS: opts.cssSupports === undefined ? undefined : {supports: function () { return opts.cssSupports; }},
        addEventListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        ResizeObserver: opts.resizeObserver
    };
}

function fakeDoc(heights) {
    var children = heights.map(function (h) {
        return {tagName: "LI", offsetWidth: 480, offsetHeight: h, style: {}};
    });
    children.push({tagName: "DIV", offsetWidth: 1, offsetHeight: 1, style: {}}); // not a card
    var list = {className: "entity-list masonry", children: children, clientWidth: 980, style: {}};
    return {list: list, children: children, querySelector: function () { return list; }};
}

test("start places the cards of the page and again when the window changes size", function () {
    var doc = fakeDoc([100, 40, 40]);
    var win = fakeWindow({});
    var relayout = masonry.start(doc, win);
    assert.strictEqual(typeof relayout, "function");
    assert.strictEqual(doc.children[0].style.left, "0px");
    assert.strictEqual(doc.children[1].style.left, "490px");
    assert.strictEqual(doc.children[2].style.top, "50px");
    assert.strictEqual(doc.children[3].style.left, undefined); // not a card

    ["load", "resize", "orientationchange"].forEach(function (name) {
        assert.strictEqual(win.listeners[name].length, 1, name);
    });

    doc.list.clientWidth = 480;
    win.listeners.resize[0]();
    assert.strictEqual(doc.children[1].style.left, "0px");
    assert.strictEqual(doc.children[1].style.top, "110px");
});

test("a browser with CSS Grid Lanes is not given the script's layout", function () {
    var doc = fakeDoc([100, 40]);
    masonry.start(doc, fakeWindow({cssSupports: true}));
    assert.strictEqual(doc.children[0].style.left, undefined);
    assert.strictEqual(doc.list.className, "entity-list masonry");
});

test("where cards can be watched for changing size, they are", function () {
    var observed = [];
    function RO(fn) { this.fn = fn; this.observe = function (c) { observed.push(c); }; }
    var doc = fakeDoc([10, 20]);
    masonry.start(doc, fakeWindow({resizeObserver: RO}));
    assert.strictEqual(observed.length, 2);
});

var failures = 0;
tests.forEach(function (t) {
    try { t[1](); } catch (e) { failures++; console.log("FAIL: " + t[0] + "\n  " + (e.stack || e)); }
});
console.log((tests.length - failures) + " of " + tests.length + " passed");
process.exit(failures ? 1 : 0);
