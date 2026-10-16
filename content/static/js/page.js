/*
 * What every page does for itself, in the browser:
 *
 * - It reloads itself to stay current, 30 seconds after it loaded, but not while someone is using it: a reload while a
 *   finger is on the menu or scrolling the page throws away what they were doing. It waits until nothing has touched the
 *   page for 10 seconds.
 *
 * - While there is a critical alert nobody has acknowledged (the header's alert indicator is red), it plays a soft chime
 *   when the page loads, at most about once a minute, and shows a speaker button next to the indicator that silences it.
 *   Silencing is for this browser, and is kept with the browser's own storage, so it survives closing the browser and
 *   restarting the device.
 *
 * Browsers will not play a sound for a page nobody has touched, and some (Safari on an iPad) ask again for every page that
 * is loaded. Where that is so the chime waits for the next touch, and the button says that the sound is blocked and what
 * to do about it.
 *
 * This is written to run on old browsers, an iPad that no longer gets updates among them: plain ES5, with no arrow
 * functions, classes, let or const, template literals, Map, or async functions, and the sound is an <audio> element playing
 * a WAV that is made here, not the Web Audio API, which older Safari only half has.
 *
 * The logic is in objects that are given everything they use from outside (the clock, timers, storage, the sound, the
 * button), so that it can be tested with fakes: see js_test/page_test.js.
 */
(function (global) {
    "use strict";

    // How long after a page loaded it reloads, and how long it has to have been left alone for first.
    var REFRESH_AFTER_MS = 30 * 1000;
    var QUIET_FOR_MS = 10 * 1000;

    // The least time between chimes. The page reloads every 30 seconds, so this is a chime on every other load.
    var MIN_CHIME_GAP_MS = 50 * 1000;

    var SILENCED_KEY = "pmaas.chime.silenced";
    var LAST_CHIME_KEY = "pmaas.chime.lastPlayed";

    // Things that mean someone is using the page. Moving a mouse over it isn't one: a page on a desk would never reload.
    var ACTIVITY_EVENTS = ["touchstart", "touchmove", "touchend", "pointerdown", "wheel", "scroll", "keydown"];

    // The things a browser counts as a person doing something, which is what lets it play a sound. On an iPad it is the end
    // of a touch, not the start.
    var GESTURE_EVENTS = ["touchend", "pointerup", "mouseup", "click", "keydown"];

    /** Browser storage that doesn't mind not being there: private windows and full disks make it throw. */
    function Settings(storage) {
        this.storage = storage;
        this.memory = {};
    }

    Settings.prototype.get = function (key) {
        try {
            var value = this.storage ? this.storage.getItem(key) : null;

            if (value !== null && value !== undefined) {
                return value;
            }
        } catch (error) {
            // Fall through to what was kept in memory.
        }

        return Object.prototype.hasOwnProperty.call(this.memory, key) ? this.memory[key] : undefined;
    };

    Settings.prototype.set = function (key, value) {
        this.memory[key] = value;

        try {
            if (this.storage) {
                this.storage.setItem(key, value);
            }
        } catch (error) {
            // Kept in memory, for as long as the page lives.
        }
    };

    /** Reloads the page, once it is old enough and has been left alone for long enough. */
    function RefreshTimer(env) {
        this.now = env.now;
        this.setTimer = env.setTimer;
        this.clearTimer = env.clearTimer;
        this.reload = env.reload;
        this.refreshAfterMs = env.refreshAfterMs === undefined ? REFRESH_AFTER_MS : env.refreshAfterMs;
        this.quietForMs = env.quietForMs === undefined ? QUIET_FOR_MS : env.quietForMs;
        this.loadedAt = 0;
        this.lastActivity = -Infinity;
        this.timer = null;
    }

    RefreshTimer.prototype.start = function () {
        this.loadedAt = this.now();
        this.arm();
    };

    RefreshTimer.prototype.stop = function () {
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
    };

    /** Someone is using the page. This is cheap, because scrolling calls it constantly. */
    RefreshTimer.prototype.activity = function () {
        this.lastActivity = this.now();
    };

    /** The earliest time it may reload: old enough, and quiet for long enough. */
    RefreshTimer.prototype.earliest = function () {
        return Math.max(this.loadedAt + this.refreshAfterMs, this.lastActivity + this.quietForMs);
    };

    RefreshTimer.prototype.arm = function () {
        var self = this;

        this.timer = this.setTimer(function () {
            self.check();
        }, Math.max(this.earliest() - this.now(), 0));
    };

    RefreshTimer.prototype.check = function () {
        this.timer = null;

        if (this.now() >= this.earliest()) {
            this.reload();
        } else {
            // Touched since the timer was set: wait for the new time.
            this.arm();
        }
    };

    /**
     * A soft chime as the bytes of a WAV file: two bell-like notes a fifth apart, each coming up in a few hundredths of a
     * second and ringing away, quietly. It is made here so that there is no sound file to serve, and as a WAV because
     * every browser that can play sound can play that.
     */
    function chimeWav() {
        var sampleRate = 22050;
        var seconds = 2.0;
        var count = Math.floor(sampleRate * seconds);
        var notes = [{frequency: 659.25, start: 0, peak: 0.28}, {frequency: 987.77, start: 0.2, peak: 0.2}];
        var samples = new Array(count);
        var i;
        var n;

        for (i = 0; i < count; i++) {
            var t = i / sampleRate;
            var value = 0;

            for (n = 0; n < notes.length; n++) {
                var age = t - notes[n].start;

                if (age >= 0) {
                    var attack = Math.min(age / 0.03, 1);
                    var ring = Math.exp(-age * 3.2);

                    value += notes[n].peak * attack * ring * Math.sin(2 * Math.PI * notes[n].frequency * age);
                }
            }

            samples[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
        }

        var bytes = [];

        function text(s) {
            for (var c = 0; c < s.length; c++) {
                bytes.push(s.charCodeAt(c));
            }
        }

        function number(value, size) {
            for (var b = 0; b < size; b++) {
                bytes.push(Math.floor(value / Math.pow(256, b)) % 256);
            }
        }

        var dataSize = count * 2;

        text("RIFF");
        number(36 + dataSize, 4);
        text("WAVE");
        text("fmt ");
        number(16, 4);
        number(1, 2); // PCM
        number(1, 2); // mono
        number(sampleRate, 4);
        number(sampleRate * 2, 4);
        number(2, 2);
        number(16, 2);
        text("data");
        number(dataSize, 4);

        for (i = 0; i < count; i++) {
            var sample = samples[i] < 0 ? samples[i] + 65536 : samples[i];

            number(sample, 2);
        }

        return bytes;
    }

    /** The chime as a data: URL. */
    function chimeUrl(btoa) {
        var bytes = chimeWav();
        var binary = "";

        for (var i = 0; i < bytes.length; i += 4096) {
            binary += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
        }

        return "data:audio/wav;base64," + btoa(binary);
    }

    /**
     * Chimes while there is a critical alert, unless this browser has silenced it, and says so on a button.
     *
     * env: now(), settings (a Settings), critical() (whether there is a critical alert on the page), createSound() (an
     * object like an <audio> element: play(), paused, currentTime; or throws if there is no audio), and view (what shows
     * the button: render(model), where the model is {state, label}, or null for no button).
     */
    function Chime(env) {
        this.now = env.now;
        this.settings = env.settings;
        this.critical = env.critical;
        this.createSound = env.createSound;
        this.view = env.view;
        this.sound = null;
        this.unsupported = false;
        this.blocked = false;
    }

    Chime.prototype.silenced = function () {
        return this.settings.get(SILENCED_KEY) === "1";
    };

    Chime.prototype.lastPlayed = function () {
        var value = Number(this.settings.get(LAST_CHIME_KEY));

        return isFinite(value) ? value : 0;
    };

    Chime.prototype.due = function () {
        return this.now() - this.lastPlayed() >= MIN_CHIME_GAP_MS;
    };

    /** Called once the page has loaded. */
    Chime.prototype.start = function () {
        var self = this;

        if (this.critical() && !this.silenced() && this.due()) {
            this.attempt(false, function () {
                self.render();
            });
        } else {
            this.render();
        }
    };

    /** The sound is on, silenced, blocked by the browser, or not possible at all. */
    Chime.prototype.state = function () {
        if (this.unsupported) {
            return "unsupported";
        }

        if (this.silenced()) {
            return "silenced";
        }

        return this.blocked ? "blocked" : "on";
    };

    Chime.prototype.render = function () {
        if (this.unsupported || !this.critical()) {
            this.view.render(null);

            return;
        }

        var state = this.state();
        var labels = {
            on: "A critical alert chimes about once a minute. Press to silence it on this device.",
            silenced: "The chime is silenced on this device. Press to turn it back on.",
            blocked: "The browser is not allowing sound until the screen is touched. Press to allow the chime."
        };

        this.view.render({state: state, label: labels[state]});
    };

    Chime.prototype.getSound = function () {
        if (this.sound === null && !this.unsupported) {
            try {
                this.sound = this.createSound();
            } catch (error) {
                this.unsupported = true;
            }
        }

        return this.sound;
    };

    Chime.prototype.played = function () {
        this.blocked = false;
        this.settings.set(LAST_CHIME_KEY, String(this.now()));
    };

    /**
     * Plays the chime if the browser lets it, and says whether it did, by calling done(played). gesture is whether this is
     * being called from a touch or a click, which is the only place some browsers will start a sound: it must call play()
     * before it does anything else, with nothing waited for first.
     */
    Chime.prototype.attempt = function (gesture, done) {
        var self = this;
        var sound = this.getSound();

        if (sound === null) {
            done(false);

            return;
        }

        var result;

        try {
            sound.currentTime = 0;
        } catch (error) {
            // Not all of them like being rewound before they have loaded; it starts from the beginning anyway.
        }

        try {
            result = sound.play();
        } catch (error) {
            this.blocked = true;
            done(false);

            return;
        }

        if (result && typeof result.then === "function") {
            // A modern browser says whether it was allowed.
            result.then(function () {
                self.played();
                done(true);
            }, function () {
                self.blocked = true;
                done(false);
            });

            return;
        }

        // An old one says nothing. If it is playing, it was allowed; if it is not, it was not.
        if (sound.paused === false || (gesture && sound.paused === undefined)) {
            this.played();
            done(true);
        } else {
            this.blocked = true;
            done(false);
        }
    };

    /** The button was pressed. */
    Chime.prototype.toggle = function () {
        var self = this;

        if (this.unsupported) {
            return;
        }

        function rendered() {
            self.render();
        }

        if (this.state() === "blocked") {
            // Pressing it is what the browser wanted. Chime now, as proof.
            this.attempt(true, rendered);
        } else if (this.silenced()) {
            this.settings.set(SILENCED_KEY, "0");
            this.attempt(true, rendered);
        } else {
            this.settings.set(SILENCED_KEY, "1");
            this.render();
        }
    };

    /** The person touched the page. If the sound was blocked, now it can't be, so chime if one is due. */
    Chime.prototype.gesture = function () {
        var self = this;

        if (!this.blocked || this.silenced() || !this.critical() || !this.due()) {
            return;
        }

        this.attempt(true, function () {
            self.render();
        });
    };

    /** The speaker button, next to the alert indicator in the page header. */
    function ChimeButton(document, indicator, onPress) {
        this.document = document;
        this.indicator = indicator;
        this.onPress = onPress;
        this.button = null;
        this.icon = null;
    }

    /** Shows the button for the model, or removes it for null. */
    ChimeButton.prototype.render = function (model) {
        var self = this;

        if (model === null) {
            if (this.button !== null && this.button.parentNode) {
                this.button.parentNode.removeChild(this.button);
            }

            this.button = null;
            this.icon = null;

            return;
        }

        if (this.button === null) {
            this.button = this.document.createElement("button");
            this.button.type = "button";
            this.button.className = "chime-toggle";
            this.icon = this.document.createElement("i");
            this.button.appendChild(this.icon);
            this.button.addEventListener("click", function () {
                self.onPress();
            }, false);
            this.indicator.parentNode.insertBefore(this.button, this.indicator.nextSibling);
        }

        var icons = {on: "volume-up-fill", silenced: "volume-mute-fill", blocked: "volume-off-fill"};

        this.icon.className = "bi bi-" + icons[model.state];
        this.button.setAttribute("title", model.label);
        this.button.setAttribute("aria-label", model.label);
        this.button.setAttribute("data-state", model.state);
    };

    /** Whether addEventListener understands an options object, as newer browsers do, and older ones take it as capture. */
    function listenerOptions(document) {
        var supportsPassive = false;

        try {
            var options = Object.defineProperty({}, "passive", {
                get: function () {
                    supportsPassive = true;

                    return true;
                }
            });

            document.addEventListener("pmaas-probe", null, options);
            document.removeEventListener("pmaas-probe", null, options);
        } catch (error) {
            supportsPassive = false;
        }

        return supportsPassive ? {passive: true, capture: true} : true;
    }

    /** Wires it all to the real page. */
    function start(env) {
        var document = env.document;
        var chime = null;

        var refresh = new RefreshTimer({
            now: env.now,
            setTimer: env.setTimer,
            clearTimer: env.clearTimer,
            reload: env.reload
        });

        function indicator() {
            return document.querySelector(".page-header .alert-indicator.critical");
        }

        var view = {
            button: null,
            render: function (model) {
                if (view.button === null) {
                    var found = indicator();

                    if (found === null) {
                        return;
                    }

                    view.button = new ChimeButton(document, found, function () {
                        chime.toggle();
                    });
                }

                view.button.render(model);
            }
        };

        chime = new Chime({
            now: env.now,
            settings: new Settings(env.storage),
            critical: function () {
                return indicator() !== null;
            },
            createSound: env.createSound,
            view: view
        });

        var options = listenerOptions(document);

        ACTIVITY_EVENTS.forEach(function (name) {
            document.addEventListener(name, function () {
                refresh.activity();
            }, options);
        });

        GESTURE_EVENTS.forEach(function (name) {
            document.addEventListener(name, function () {
                chime.gesture();
            }, options);
        });

        refresh.start();
        chime.start();

        return {refresh: refresh, chime: chime};
    }

    var exported = {
        REFRESH_AFTER_MS: REFRESH_AFTER_MS,
        QUIET_FOR_MS: QUIET_FOR_MS,
        MIN_CHIME_GAP_MS: MIN_CHIME_GAP_MS,
        SILENCED_KEY: SILENCED_KEY,
        LAST_CHIME_KEY: LAST_CHIME_KEY,
        ACTIVITY_EVENTS: ACTIVITY_EVENTS,
        GESTURE_EVENTS: GESTURE_EVENTS,
        Settings: Settings,
        RefreshTimer: RefreshTimer,
        Chime: Chime,
        ChimeButton: ChimeButton,
        chimeWav: chimeWav,
        chimeUrl: chimeUrl,
        listenerOptions: listenerOptions,
        start: start
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    if (typeof document !== "undefined" && typeof global.window !== "undefined" && global === global.window) {
        var run = function () {
            start({
                document: document,
                now: function () {
                    return new Date().getTime();
                },
                setTimer: function (fn, ms) {
                    return global.setTimeout(fn, ms);
                },
                clearTimer: function (id) {
                    global.clearTimeout(id);
                },
                reload: function () {
                    global.location.reload();
                },
                storage: (function () {
                    try {
                        return global.localStorage;
                    } catch (error) {
                        return null;
                    }
                })(),
                createSound: function () {
                    var sound = new global.Audio(chimeUrl(function (binary) {
                        return global.btoa(binary);
                    }));

                    sound.preload = "auto";
                    sound.volume = 0.6;

                    return sound;
                }
            });
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", run, false);
        } else {
            run();
        }
    }
})(typeof window !== "undefined" ? window : globalThis);
