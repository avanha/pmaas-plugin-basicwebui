/*
 * Masonry for the pages that ask for it (spi.RenderListOptions.Masonry), in the browsers that don't have it in CSS.
 *
 * Browsers with CSS Grid Lanes (display: grid-lanes, see entity_list.css) lay the cards out themselves and this does nothing.
 * Elsewhere the cards are the wrapping rows of equal height they always were until this runs, and then they are placed by hand:
 * fixed-width columns across the page, each card going into the shortest column, the first row filling left to right. If this
 * doesn't run (scripts off, a browser too old for it) the rows stay, which is acceptable.
 *
 * Plain ES5, no arrow functions, classes, let or const, for the old Safari on an iPad. The placing is a function of the cards' sizes
 * and the width of the page, so that it is tested with node (js_test/masonry_test.js) without a browser.
 */
(function (global) {
    "use strict";

    // How much taller a column may be than the shortest and still be chosen when it is further left. It is Grid Lanes' own default,
    // 1em, so that cards whose columns are almost level go left to right as they would in a browser that has it, and don't shuffle
    // because one is a few pixels taller.
    var TOLERANCE_PX = 16;

    // The space between cards, which is what the rows of cards have always had (5px on each side of a card and 10px below).
    var GAP_PX = 10;

    /*
     * place says where each card goes. sizes are the cards' widths and heights, in order, without the gap; width is the width of the
     * space they go in. It returns each card's left and top, the height of the lot, and how many columns there are.
     */
    function place(sizes, width, gap, tolerance) {
        var i;
        var j;
        var columnWidth = 0;

        for (i = 0; i < sizes.length; i++) {
            columnWidth = Math.max(columnWidth, sizes[i].width);
        }

        var pitch = columnWidth + gap;
        var columns = pitch > 0 ? Math.max(1, Math.floor((width + gap) / pitch)) : 1;
        var tops = [];

        for (j = 0; j < columns; j++) {
            tops.push(0);
        }

        var positions = [];

        for (i = 0; i < sizes.length; i++) {
            var shortest = Math.min.apply(null, tops);
            var chosen = 0;

            // The leftmost column that is nearly as short as the shortest.
            for (j = 0; j < columns; j++) {
                if (tops[j] <= shortest + tolerance) {
                    chosen = j;
                    break;
                }
            }

            positions.push({left: chosen * pitch, top: tops[chosen]});
            tops[chosen] += sizes[i].height + gap;
        }

        var height = Math.max.apply(null, tops.concat([0]));

        return {positions: positions, height: Math.max(0, height - gap), columns: columns};
    }

    /*
     * layOut places the cards of a list, given what it needs from the browser: the list, whether the browser lays out masonry itself,
     * and a way to read a card's size. It reports whether it placed them.
     */
    function layOut(env) {
        var list = env.list;

        if (env.nativeMasonry()) {
            return false;
        }

        // The cards are absolutely placed from here on, which is what the class is for (see entity_list.css).
        if (list.className.indexOf("masonry-js") < 0) {
            list.className += " masonry-js";
        }

        var cards = env.cards();
        var sizes = [];
        var i;

        for (i = 0; i < cards.length; i++) {
            sizes.push(env.size(cards[i]));
        }

        var result = place(sizes, env.width(), GAP_PX, TOLERANCE_PX);

        for (i = 0; i < cards.length; i++) {
            env.move(cards[i], result.positions[i].left, result.positions[i].top);
        }

        env.setHeight(list, result.height);

        return true;
    }

    /*
     * start does it for a page: now, when the page has finished loading (fonts and icons change the heights), and when the window changes
     * size or turns. Where the browser tells of a card changing size, it does it then too.
     */
    function start(doc, win) {
        var list = doc.querySelector("ol.entity-list.masonry");

        if (!list) {
            return null;
        }

        var env = {
            list: list,
            nativeMasonry: function () {
                return !!(win.CSS && win.CSS.supports && win.CSS.supports("display", "grid-lanes"));
            },
            cards: function () {
                var found = [];
                var i;

                for (i = 0; i < list.children.length; i++) {
                    if (list.children[i].tagName === "LI") {
                        found.push(list.children[i]);
                    }
                }

                return found;
            },
            size: function (card) {
                return {width: card.offsetWidth, height: card.offsetHeight};
            },
            width: function () {
                return list.clientWidth;
            },
            move: function (card, left, top) {
                card.style.left = left + "px";
                card.style.top = top + "px";
            },
            setHeight: function (target, height) {
                target.style.height = height + "px";
            }
        };

        var relayout = function () {
            layOut(env);
        };

        relayout();

        win.addEventListener("load", relayout, false);
        win.addEventListener("resize", relayout, false);
        win.addEventListener("orientationchange", relayout, false);

        if (win.ResizeObserver) {
            var observer = new win.ResizeObserver(relayout);
            var cards = env.cards();
            var i;

            for (i = 0; i < cards.length; i++) {
                observer.observe(cards[i]);
            }
        }

        return relayout;
    }

    var exported = {place: place, layOut: layOut, start: start, TOLERANCE_PX: TOLERANCE_PX, GAP_PX: GAP_PX};

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    if (typeof document !== "undefined" && global.addEventListener) {
        var run = function () {
            start(document, global);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", run, false);
        } else {
            run();
        }
    }
})(typeof window !== "undefined" ? window : globalThis);
