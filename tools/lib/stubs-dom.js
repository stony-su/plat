/* tools/lib/stubs-dom.js — owner: TOOLS */
(function (G) {
  'use strict';
  // Runs INSIDE the harness vm context (see harness.js). Installs window/document/location/
  // navigator/storage/timers/rAF/performance/console and a minimal DOM. Every object created
  // here belongs to the game's realm. Shared state lives in S (G.__AP_STUB_STATE), which the
  // harness reads from outside and removes from the global object before scripts load.
  G.__AP_STUBS = G.__AP_STUBS || {};
  G.__AP_STUBS.dom = function installDom(opts) {
    var S = {
      opts: opts,
      clock: 0,                 // virtual ms (performance.now)
      rafQueue: [], rafId: 0,
      timers: [], timerId: 0,
      console: [],
      issues: [], issueKeys: {},
      uncaught: [],
      counters: { draw: 0, rafCalls: 0, timerCalls: 0, listenersAdded: 0, storageReads: 0, storageWrites: 0, maxSaveDepth: 0 },
      canvases: [],
      currentScript: null,
      gamepads: [null, null, null, null],
      storageMode: opts.storage || 'ok',
      storageData: {},
      fullscreen: false
    };
    G.__AP_STUB_STATE = S;

    function issue(kind, msg, level, withStack) {
      var key = kind + '|' + msg;
      if (S.issueKeys[key]) { S.issueKeys[key].count++; return; }
      var it = { kind: kind, msg: msg, level: level || 'warn', count: 1, script: S.currentScript, stack: withStack ? callerStack() : null };
      S.issueKeys[key] = it;
      S.issues.push(it);
    }
    function callerStack() {
      var st = String(new Error().stack || '').split('\n');
      var keep = [];
      for (var i = 1; i < st.length && keep.length < 4; i++) {
        if (st[i].indexOf('stubs-') >= 0) continue;
        keep.push(st[i].trim());
      }
      return keep.join(' | ');
    }
    S.issue = issue;
    S.callerStack = callerStack;

    // ------------------------------------------------------------ DOMException
    function DOMException(message, name) {
      var e = new Error(message);
      Object.setPrototypeOf(e, DOMException.prototype);
      e.name = name || 'Error';
      e.code = 0;
      return e;
    }
    DOMException.prototype = Object.create(Error.prototype);
    DOMException.prototype.constructor = DOMException;
    G.DOMException = DOMException;
    S.DOMException = DOMException;

    // ------------------------------------------------------------ events
    function Event(type, init) {
      init = init || {};
      this.type = String(type);
      this.bubbles = !!init.bubbles;
      this.cancelable = init.cancelable !== false;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.timeStamp = S.clock;
      this.isTrusted = true;
      this._stop = false;
      for (var k in init) if (!(k in this)) this[k] = init[k];
    }
    Event.prototype.preventDefault = function () { if (this.cancelable) this.defaultPrevented = true; };
    Event.prototype.stopPropagation = function () { this._stop = true; };
    Event.prototype.stopImmediatePropagation = function () { this._stop = true; this._stopNow = true; };
    Event.prototype.composedPath = function () { return this.target ? [this.target] : []; };
    function subEvent(name) {
      var C = function (type, init) { Event.call(this, type, init); };
      C.prototype = Object.create(Event.prototype);
      C.prototype.constructor = C;
      G[name] = C;
      return C;
    }
    G.Event = Event;
    var KeyboardEvent = subEvent('KeyboardEvent');
    var MouseEvent = subEvent('MouseEvent');
    var PointerEvent = subEvent('PointerEvent');
    subEvent('TouchEvent'); subEvent('FocusEvent'); subEvent('WheelEvent'); subEvent('GamepadEvent');
    subEvent('CustomEvent'); subEvent('HashChangeEvent'); subEvent('UIEvent'); subEvent('ProgressEvent');
    S.KeyboardEvent = KeyboardEvent; S.MouseEvent = MouseEvent; S.PointerEvent = PointerEvent;

    var EventTargetProto = {
      addEventListener: function (type, fn, o) {
        if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
        if (!this.__ls) Object.defineProperty(this, '__ls', { value: {}, enumerable: false, writable: true });
        var list = this.__ls[type] || (this.__ls[type] = []);
        for (var i = 0; i < list.length; i++) if (list[i].fn === fn) return;
        list.push({ fn: fn, once: !!(o && typeof o === 'object' && o.once) });
        S.counters.listenersAdded++;
      },
      removeEventListener: function (type, fn) {
        if (!this.__ls || !this.__ls[type]) return;
        var list = this.__ls[type];
        for (var i = 0; i < list.length; i++) if (list[i].fn === fn) { list.splice(i, 1); return; }
      },
      dispatchEvent: function (evt) {
        if (!evt || typeof evt.type !== 'string') throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.");
        if (!evt.target) evt.target = this;
        evt.currentTarget = this;
        var handlerProp = this['on' + evt.type];
        var list = this.__ls && this.__ls[evt.type] ? this.__ls[evt.type].slice() : [];
        for (var i = 0; i < list.length; i++) {
          var l = list[i];
          if (l.once) this.removeEventListener(evt.type, l.fn);
          S.invoke(typeof l.fn === 'function' ? l.fn : l.fn.handleEvent, typeof l.fn === 'function' ? this : l.fn, [evt], 'event ' + evt.type);
          if (evt._stopNow) break;
        }
        if (typeof handlerProp === 'function') S.invoke(handlerProp, this, [evt], 'on' + evt.type);
        return !evt.defaultPrevented;
      },
      listenerCount: function (type) { return this.__ls && this.__ls[type] ? this.__ls[type].length : 0; }
    };
    S.EventTargetProto = EventTargetProto;
    function mixEvents(obj) {
      obj.addEventListener = EventTargetProto.addEventListener;
      obj.removeEventListener = EventTargetProto.removeEventListener;
      obj.dispatchEvent = EventTargetProto.dispatchEvent;
      return obj;
    }
    function EventTarget() {}
    EventTarget.prototype.addEventListener = EventTargetProto.addEventListener;
    EventTarget.prototype.removeEventListener = EventTargetProto.removeEventListener;
    EventTarget.prototype.dispatchEvent = EventTargetProto.dispatchEvent;
    G.EventTarget = EventTarget;

    // Calls a callback the way the browser would: exceptions become "uncaught" errors.
    S.invoke = function (fn, self, args, label) {
      try { return fn.apply(self, args || []); }
      catch (e) {
        S.uncaught.push({ label: label || 'callback', message: String(e && e.message || e), stack: String(e && e.stack || ''), script: S.currentScript });
        try { if (typeof G.onerror === 'function') G.onerror(String(e && e.message), '', 0, 0, e); } catch (e2) { /* ignore */ }
        return undefined;
      }
    };

    // ------------------------------------------------------------ elements
    var idCounter = 0;
    function Style() {}
    Style.prototype.setProperty = function (k, v) { this[k] = String(v); };
    Style.prototype.removeProperty = function (k) { var v = this[k]; delete this[k]; return v || ''; };
    Style.prototype.getPropertyValue = function (k) { return this[k] || ''; };

    function ClassList(el) { this._el = el; }
    ClassList.prototype._get = function () { return String(this._el.className || '').split(/\s+/).filter(Boolean); };
    ClassList.prototype._set = function (a) { this._el.className = a.join(' '); };
    ClassList.prototype.add = function () { var a = this._get(); for (var i = 0; i < arguments.length; i++) if (a.indexOf(arguments[i]) < 0) a.push(arguments[i]); this._set(a); };
    ClassList.prototype.remove = function () { var a = this._get(); for (var i = 0; i < arguments.length; i++) { var j = a.indexOf(arguments[i]); if (j >= 0) a.splice(j, 1); } this._set(a); };
    ClassList.prototype.contains = function (c) { return this._get().indexOf(c) >= 0; };
    ClassList.prototype.toggle = function (c, force) { var has = this.contains(c); var want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; };
    ClassList.prototype.replace = function (a, b) { if (!this.contains(a)) return false; this.remove(a); this.add(b); return true; };

    function Node() {}
    Node.prototype = Object.create(EventTarget.prototype);
    G.Node = Node;
    function Element(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.nodeName = this.tagName;
      this.nodeType = 1;
      this.id = '';
      this.className = '';
      this.style = new Style();
      this.dataset = {};
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.parentElement = null;
      this.textContent = '';
      this.innerText = '';
      this.value = '';
      this.hidden = false;
      this.tabIndex = -1;
      this.disabled = false;
      this._attrs = {};
      this.__uid = ++idCounter;
      Object.defineProperty(this, 'classList', { value: new ClassList(this), enumerable: false });
    }
    Element.prototype = Object.create(Node.prototype);
    Element.prototype.constructor = Element;
    G.Element = Element;
    G.HTMLElement = Element;
    Element.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); if (k === 'width' && 'width' in this) this.width = +v; if (k === 'height' && 'height' in this) this.height = +v; };
    Element.prototype.getAttribute = function (k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className || null; return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
    Element.prototype.hasAttribute = function (k) { return this.getAttribute(k) !== null; };
    Element.prototype.removeAttribute = function (k) { delete this._attrs[k]; };
    Element.prototype.appendChild = function (c) {
      if (!c || typeof c !== 'object') throw new TypeError("Failed to execute 'appendChild': parameter 1 is not of type 'Node'.");
      if (c.parentNode) c.parentNode.removeChild(c);
      this.children.push(c); c.parentNode = this; c.parentElement = this; return c;
    };
    Element.prototype.append = function () { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (typeof a === 'string') a = G.document.createTextNode(a); this.appendChild(a); } };
    Element.prototype.prepend = function () { for (var i = arguments.length - 1; i >= 0; i--) { var a = arguments[i]; if (typeof a === 'string') a = G.document.createTextNode(a); this.insertBefore(a, this.children[0] || null); } };
    Element.prototype.insertBefore = function (c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; c.parentElement = this; return c;
    };
    Element.prototype.removeChild = function (c) {
      var i = this.children.indexOf(c);
      if (i < 0) throw DOMException("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", 'NotFoundError');
      this.children.splice(i, 1); c.parentNode = null; c.parentElement = null; return c;
    };
    Element.prototype.replaceChild = function (n, o) { var i = this.children.indexOf(o); if (i < 0) throw DOMException('not a child', 'NotFoundError'); this.children[i] = n; n.parentNode = this; o.parentNode = null; return o; };
    Element.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
    Element.prototype.contains = function (o) { if (o === this) return true; for (var i = 0; i < this.children.length; i++) if (this.children[i].contains && this.children[i].contains(o)) return true; return false; };
    Element.prototype.cloneNode = function () { var e = new Element(this.tagName); e.className = this.className; return e; };
    Element.prototype.matches = function (sel) { return matchSel(this, sel); };
    Element.prototype.closest = function (sel) { var e = this; while (e && e.nodeType === 1) { if (matchSel(e, sel)) return e; e = e.parentNode; } return null; };
    Element.prototype.querySelector = function (sel) { var r = []; walk(this, sel, r, true); return r[0] || null; };
    Element.prototype.querySelectorAll = function (sel) { var r = []; walk(this, sel, r, false); return r; };
    Element.prototype.getElementsByTagName = function (t) { return this.querySelectorAll(String(t).toLowerCase()); };
    Element.prototype.getElementsByClassName = function (c) { return this.querySelectorAll('.' + c); };
    Element.prototype.getBoundingClientRect = function () {
      var w = this.clientWidth, h = this.clientHeight;
      return { x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h, toJSON: function () { return this; } };
    };
    Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
    Object.defineProperty(Element.prototype, 'clientWidth', { get: function () { return parseFloat(this.style.width) || (this.width | 0) || (this.tagName === 'BODY' || this.tagName === 'HTML' || this.id === 'stage' ? S.opts.innerWidth : 0); } });
    Object.defineProperty(Element.prototype, 'clientHeight', { get: function () { return parseFloat(this.style.height) || (this.height | 0) || (this.tagName === 'BODY' || this.tagName === 'HTML' || this.id === 'stage' ? S.opts.innerHeight : 0); } });
    Object.defineProperty(Element.prototype, 'offsetWidth', { get: function () { return this.clientWidth; } });
    Object.defineProperty(Element.prototype, 'offsetHeight', { get: function () { return this.clientHeight; } });
    Object.defineProperty(Element.prototype, 'offsetLeft', { get: function () { return 0; } });
    Object.defineProperty(Element.prototype, 'offsetTop', { get: function () { return 0; } });
    Object.defineProperty(Element.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
    Object.defineProperty(Element.prototype, 'lastChild', { get: function () { return this.children[this.children.length - 1] || null; } });
    Object.defineProperty(Element.prototype, 'firstElementChild', { get: function () { return this.children[0] || null; } });
    Object.defineProperty(Element.prototype, 'childElementCount', { get: function () { return this.children.length; } });
    Object.defineProperty(Element.prototype, 'ownerDocument', { get: function () { return G.document; } });
    Object.defineProperty(Element.prototype, 'isConnected', { get: function () { var e = this; while (e) { if (e === G.document.documentElement) return true; e = e.parentNode; } return false; } });
    Object.defineProperty(Element.prototype, 'innerHTML', {
      get: function () { return ''; },
      set: function () { issue('innerHTML', 'innerHTML was set (banned by CONTRACT §0)', 'error', true); }
    });
    Element.prototype.focus = function () { G.document.activeElement = this; };
    Element.prototype.blur = function () { if (G.document.activeElement === this) G.document.activeElement = G.document.body; };
    Element.prototype.click = function () { this.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
    Element.prototype.select = function () {};
    Element.prototype.scrollIntoView = function () {};
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    Element.prototype.hasPointerCapture = function () { return false; };
    Element.prototype.requestPointerLock = function () {};
    Element.prototype.requestFullscreen = function () { S.fullscreen = true; G.document.fullscreenElement = this; return Promise.resolve(); };
    Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.animate = function () { return { cancel: function () {}, finished: Promise.resolve(), onfinish: null }; };
    Element.prototype.attachShadow = function () { return new Element('shadow-root'); };

    function matchSel(el, sel) {
      sel = String(sel).trim();
      if (sel === '*') return true;
      var parts = sel.split(',');
      for (var p = 0; p < parts.length; p++) {
        var s = parts[p].trim().split(/\s+/).pop();
        var m = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)(\[[^\]]+\])?$/.exec(s);
        if (!m) continue;
        if (m[1] && el.tagName !== m[1].toUpperCase()) continue;
        if (m[2] && el.id !== m[2].slice(1)) continue;
        if (m[3]) {
          var cls = m[3].split('.').filter(Boolean), okc = true;
          for (var c = 0; c < cls.length; c++) if (!el.classList.contains(cls[c])) okc = false;
          if (!okc) continue;
        }
        if (m[4]) {
          var am = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(m[4]);
          if (am && (el.getAttribute(am[1]) === null || (am[2] !== undefined && el.getAttribute(am[1]) !== am[2]))) continue;
        }
        return true;
      }
      return false;
    }
    function walk(root, sel, out, first) {
      for (var i = 0; i < root.children.length; i++) {
        var c = root.children[i];
        if (c.nodeType !== 1) continue;
        if (matchSel(c, sel)) { out.push(c); if (first) return; }
        walk(c, sel, out, first);
        if (first && out.length) return;
      }
    }

    function TextNode(t) { this.nodeType = 3; this.textContent = String(t); this.nodeValue = this.textContent; this.children = []; this.parentNode = null; }
    TextNode.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };

    // Canvas element is completed by stubs-canvas.js (getContext etc.)
    function HTMLCanvasElement() {
      Element.call(this, 'canvas');
      this._w = 300; this._h = 150;
      this.__ctxType = null; this.__ctx = null;
      S.canvases.push(this);
    }
    HTMLCanvasElement.prototype = Object.create(Element.prototype);
    HTMLCanvasElement.prototype.constructor = HTMLCanvasElement;
    G.HTMLCanvasElement = HTMLCanvasElement;
    S.HTMLCanvasElement = HTMLCanvasElement;

    function HTMLImageElement() { Element.call(this, 'img'); this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.width = 0; this.height = 0; this.decoding = 'auto'; }
    HTMLImageElement.prototype = Object.create(Element.prototype);
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: function () { return this._src || ''; },
      set: function (v) {
        this._src = String(v);
        if (!/^data:/.test(this._src)) issue('asset', 'image src set to "' + this._src.slice(0, 80) + '" (asset files/network are banned)', 'error', true);
      }
    });
    HTMLImageElement.prototype.decode = function () { return Promise.resolve(); };
    G.HTMLImageElement = HTMLImageElement;
    G.Image = function (w, h) { var im = new HTMLImageElement(); if (w) im.width = w; if (h) im.height = h; return im; };
    G.Image.prototype = HTMLImageElement.prototype;
    function HTMLMediaElement(tag) { Element.call(this, tag); this.paused = true; this.currentTime = 0; this.volume = 1; this.muted = false; }
    HTMLMediaElement.prototype = Object.create(Element.prototype);
    HTMLMediaElement.prototype.play = function () { issue('asset', '<' + this.tagName.toLowerCase() + '>.play() (media assets are banned)', 'error', true); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
    G.Audio = function () { issue('asset', 'new Audio() (sampled audio is banned; synthesize)', 'error', true); return new HTMLMediaElement('audio'); };

    // ------------------------------------------------------------ document
    var docEl = new Element('html');
    var head = new Element('head');
    var body = new Element('body');
    docEl.appendChild(head); docEl.appendChild(body);
    var document = mixEvents({
      nodeType: 9,
      documentElement: docEl, head: head, body: body,
      readyState: 'complete', visibilityState: 'visible', hidden: false,
      title: 'APEIRON', cookie: '', referrer: '', characterSet: 'UTF-8', compatMode: 'CSS1Compat',
      activeElement: body, fullscreenElement: null, fullscreenEnabled: true, pointerLockElement: null,
      defaultView: G,
      fonts: { ready: Promise.resolve(), status: 'loaded', load: function () { return Promise.resolve([]); }, check: function () { return true; }, add: function () {}, forEach: function () {} },
      createElement: function (tag) {
        tag = String(tag).toLowerCase();
        if (tag === 'canvas') return new HTMLCanvasElement();
        if (tag === 'img') return new HTMLImageElement();
        if (tag === 'audio' || tag === 'video') return new HTMLMediaElement(tag);
        if (tag === 'script') { var s = new Element('script'); Object.defineProperty(s, 'src', { set: function (v) { issue('network', 'dynamic <script src="' + v + '"> (classic scripts are loaded by index.html only)', 'error', true); }, get: function () { return ''; } }); return s; }
        if (tag === 'a') { var a = new Element('a'); a.href = ''; a.download = ''; a.click = function () { S.downloads = (S.downloads || 0) + 1; }; return a; }
        if (tag === 'input' || tag === 'textarea' || tag === 'select') { var inp = new Element(tag); inp.files = []; inp.checked = false; inp.type = 'text'; return inp; }
        return new Element(tag);
      },
      createElementNS: function (ns, tag) { return this.createElement(String(tag).replace(/^.*:/, '')); },
      createTextNode: function (t) { return new TextNode(t); },
      createDocumentFragment: function () { return new Element('#fragment'); },
      createEvent: function () { return new Event(''); },
      getElementById: function (id) { var r = []; walk(docEl, '#' + id, r, true); return r[0] || null; },
      querySelector: function (sel) { return docEl.querySelector(sel); },
      querySelectorAll: function (sel) { return docEl.querySelectorAll(sel); },
      getElementsByTagName: function (t) { return docEl.getElementsByTagName(t); },
      getElementsByClassName: function (c) { return docEl.getElementsByClassName(c); },
      hasFocus: function () { return true; },
      exitFullscreen: function () { S.fullscreen = false; document.fullscreenElement = null; return Promise.resolve(); },
      exitPointerLock: function () {},
      execCommand: function () { return false; },
      getSelection: function () { return { removeAllRanges: function () {}, addRange: function () {}, toString: function () { return ''; } }; },
      elementFromPoint: function () { return null; }
    });
    document.webkitExitFullscreen = document.exitFullscreen;
    Object.defineProperty(document, 'currentScript', { get: function () { if (!S.currentScript) return null; var s = new Element('script'); s._attrs.src = S.currentScript; s.src = S.currentScript; return s; } });
    G.document = document;
    G.HTMLDocument = function () {};

    // Build the body from a simple element tree description (from index.html), else default.
    // opts.dom: [{tag, id, cls, attrs, children:[...]}]
    function build(parent, list) {
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        var el = document.createElement(d.tag);
        if (d.id) el.id = d.id;
        if (d.cls) el.className = d.cls;
        if (d.attrs) for (var k in d.attrs) { if (k !== 'id' && k !== 'class') el.setAttribute(k, d.attrs[k]); }
        if (d.text) el.textContent = d.text;
        parent.appendChild(el);
        if (d.children) build(el, d.children);
      }
    }
    var domSpec = opts.dom && opts.dom.length ? opts.dom : [{ tag: 'div', id: 'stage', children: [{ tag: 'canvas', id: 'bg' }, { tag: 'canvas', id: 'game' }] }];
    build(body, domSpec);

    // ------------------------------------------------------------ location / history
    var hash = opts.hash ? (opts.hash.charAt(0) === '#' ? opts.hash : '#' + opts.hash) : '';
    var location = {
      protocol: 'file:', host: '', hostname: '', port: '', origin: 'null',
      pathname: '/C:/apeiron/index.html', search: '',
      reload: function () { S.reloads = (S.reloads || 0) + 1; },
      assign: function (u) { issue('navigation', 'location.assign(' + u + ')', 'warn', true); },
      replace: function (u) { issue('navigation', 'location.replace(' + u + ')', 'warn', true); },
      toString: function () { return this.href; }
    };
    Object.defineProperty(location, 'hash', {
      get: function () { return hash; },
      set: function (v) {
        v = String(v);
        if (v && v.charAt(0) !== '#') v = '#' + v;
        if (v === '#') v = '';
        var old = hash; hash = v;
        if (old !== v) G.dispatchEvent(new G.HashChangeEvent('hashchange', { oldURL: 'file:///index.html' + old, newURL: 'file:///index.html' + v }));
      },
      enumerable: true
    });
    Object.defineProperty(location, 'href', { get: function () { return 'file:///C:/apeiron/index.html' + hash; }, set: function (v) { var i = String(v).indexOf('#'); if (i >= 0) location.hash = String(v).slice(i); else issue('navigation', 'location.href = ' + v, 'warn', true); }, enumerable: true });
    G.location = location;
    document.location = location;
    G.history = {
      length: 1, state: null,
      pushState: function (st, t, url) { this.state = st; if (url && String(url).indexOf('#') >= 0) hash = String(url).slice(String(url).indexOf('#')); },
      replaceState: function (st, t, url) { this.state = st; if (url != null) { var u = String(url); hash = u.indexOf('#') >= 0 ? u.slice(u.indexOf('#')) : ''; } },
      back: function () {}, forward: function () {}, go: function () {}
    };

    // ------------------------------------------------------------ navigator
    G.navigator = {
      userAgent: 'Mozilla/5.0 (APEIRON harness) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      platform: 'Win32', language: 'en-US', languages: ['en-US', 'en'], vendor: 'Harness', onLine: false,
      hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, cookieEnabled: false, webdriver: true,
      getGamepads: function () { return S.gamepads.slice(); },
      vibrate: function () { return true; },
      clipboard: { writeText: function (t) { S.clipboard = String(t); return Promise.resolve(); }, readText: function () { return Promise.resolve(S.clipboard || ''); } },
      storage: { persist: function () { return Promise.resolve(false); }, estimate: function () { return Promise.resolve({ quota: 0, usage: 0 }); } },
      wakeLock: { request: function () { return Promise.reject(new Error('not supported')); } },
      userActivation: { hasBeenActive: true, isActive: true },
      mediaDevices: undefined
    };

    // ------------------------------------------------------------ storage
    function corruptSeed(kind) {
      var junk = {
        'invalid-json': '{"v":1,"form":5,"levels":{"w1-1":{"done":tru',
        'wrong-types': JSON.stringify({ v: 1, created: 'yesterday', playTime: -5, form: 'banana', unlocked: ['w1-1'], levels: { 'w1-1': { done: 'yes', best: 'NaN', deaths: -1, shards: 1e309, gems: 'x' }, '__proto__': { polluted: true } }, stats: null, theorems: 7, cosmetics: { trail: 42, palette: null, unlocked: 'all' }, endless: [], flags: 'none', settings: { master: 'loud', music: 9, sfx: -3, shake: null, flash: 'sometimes', particles: 99, bg: {}, keys: { jump: [] , left: 'ArrowLeft' }, pad: 5, assist: { on: 'maybe', speed: 0 } } }),
        'future-version': JSON.stringify({ v: 99, form: 99, unlocked: { 'w9-9': true }, extra: { deep: { deeper: [1, 2, 3] } } }),
        'huge': '{"v":1,"pad":"' + new Array(2000).join('xxxxxxxxxx') + '"}',
        'null': 'null',
        'array': '[1,2,3]',
        'empty': ''
      };
      return junk[kind] !== undefined ? junk[kind] : junk['invalid-json'];
    }
    if (S.storageMode === 'corrupt' || /^corrupt-/.test(S.storageMode)) {
      var kind = S.storageMode === 'corrupt' ? 'invalid-json' : S.storageMode.slice(8);
      S.storageData['apeiron.save.v1'] = corruptSeed(kind);
      S.storageData['apeiron.save.v1.bak'] = corruptSeed(kind === 'invalid-json' ? 'wrong-types' : 'invalid-json');
    }
    if (opts.storageSeed) for (var sk in opts.storageSeed) S.storageData[sk] = String(opts.storageSeed[sk]);

    function makeStorage(data, which) {
      var st = {};
      function guard() {
        if (S.storageMode === 'throws') throw DOMException("Failed to read the '" + which + "' property from 'Window': Access is denied for this document.", 'SecurityError');
      }
      Object.defineProperty(st, 'length', { get: function () { guard(); return Object.keys(data).length; } });
      st.getItem = function (k) { guard(); S.counters.storageReads++; k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; };
      st.setItem = function (k, v) {
        guard(); S.counters.storageWrites++;
        if (S.storageMode === 'quota') throw DOMException("Failed to execute 'setItem' on 'Storage': Setting the value of '" + k + "' exceeded the quota.", 'QuotaExceededError');
        data[String(k)] = String(v);
      };
      st.removeItem = function (k) { guard(); delete data[String(k)]; };
      st.clear = function () { guard(); for (var k in data) delete data[k]; };
      st.key = function (i) { guard(); var ks = Object.keys(data); return i >= 0 && i < ks.length ? ks[i] : null; };
      return st;
    }
    var local = makeStorage(S.storageData, 'localStorage');
    var session = makeStorage({}, 'sessionStorage');
    Object.defineProperty(G, 'localStorage', {
      get: function () {
        if (S.storageMode === 'throws') throw DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError');
        return local;
      }, configurable: true, enumerable: true
    });
    Object.defineProperty(G, 'sessionStorage', { get: function () { if (S.storageMode === 'throws') throw DOMException('Access is denied for this document.', 'SecurityError'); return session; }, configurable: true, enumerable: true });

    // ------------------------------------------------------------ time
    var perf = {
      now: function () { return S.clock; },
      timeOrigin: 1700000000000,
      mark: function () {}, measure: function () {}, clearMarks: function () {}, clearMeasures: function () {},
      getEntriesByName: function () { return []; }, getEntriesByType: function () { return []; },
      memory: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 }
    };
    G.performance = perf;
    G.requestAnimationFrame = function (cb) {
      if (typeof cb !== 'function') throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.");
      S.counters.rafCalls++;
      var id = ++S.rafId;
      S.rafQueue.push({ id: id, cb: cb, script: S.currentScript });
      return id;
    };
    G.cancelAnimationFrame = function (id) {
      for (var i = 0; i < S.rafQueue.length; i++) if (S.rafQueue[i].id === id) { S.rafQueue.splice(i, 1); return; }
    };
    G.webkitRequestAnimationFrame = G.requestAnimationFrame;
    function addTimer(fn, ms, repeat, args) {
      S.counters.timerCalls++;
      var id = ++S.timerId;
      ms = +ms; if (!(ms >= 0)) ms = 0;
      if (typeof fn !== 'function') { issue('timer', 'setTimeout/setInterval with a string callback (eval-like)', 'error', true); return id; }
      S.timers.push({ id: id, fn: fn, at: S.clock + ms, every: repeat ? Math.max(ms, 1) : 0, args: args, script: S.currentScript, stack: S.opts.traceTimers ? callerStack() : null });
      return id;
    }
    G.setTimeout = function (fn, ms) { return addTimer(fn, ms, false, Array.prototype.slice.call(arguments, 2)); };
    G.setInterval = function (fn, ms) { return addTimer(fn, ms, true, Array.prototype.slice.call(arguments, 2)); };
    G.clearTimeout = G.clearInterval = function (id) {
      for (var i = 0; i < S.timers.length; i++) if (S.timers[i].id === id) { S.timers.splice(i, 1); return; }
    };
    G.requestIdleCallback = function (cb) { return addTimer(function () { cb({ didTimeout: false, timeRemaining: function () { return 10; } }); }, 1, false, []); };
    G.cancelIdleCallback = G.clearTimeout;
    G.queueMicrotask = function (fn) { Promise.resolve().then(function () { S.invoke(fn, null, [], 'microtask'); }); };

    // Advances virtual time, running due timers (in time order).
    S.advance = function (ms) {
      var target = S.clock + (ms > 0 ? ms : 0);
      var guardN = 0;
      while (guardN++ < 100000) {
        var next = null;
        for (var i = 0; i < S.timers.length; i++) if (S.timers[i].at <= target && (!next || S.timers[i].at < next.at)) next = S.timers[i];
        if (!next) break;
        S.clock = Math.max(S.clock, next.at);
        if (next.every) next.at += next.every; else S.timers.splice(S.timers.indexOf(next), 1);
        S.invoke(next.fn, G, next.args, 'timer');
      }
      S.clock = target;
      if (S.onAdvance) S.onAdvance();
    };
    S.runRaf = function () {
      var q = S.rafQueue; S.rafQueue = [];
      for (var i = 0; i < q.length; i++) S.invoke(q[i].cb, G, [S.clock], 'requestAnimationFrame');
      return q.length;
    };

    // ------------------------------------------------------------ console
    function logger(level) {
      return function () {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a && a.stack && a.message) parts.push(String(a.stack).split('\n').slice(0, 3).join(' | '));
          else if (typeof a === 'object') { try { parts.push(JSON.stringify(a).slice(0, 300)); } catch (e) { parts.push(String(a)); } }
          else parts.push(String(a));
        }
        S.console.push({ level: level, text: parts.join(' '), script: S.currentScript, t: S.clock });
        if (S.console.length > 5000) S.console.splice(0, 1000);
        if (S.opts.echo) S.opts.echo(level, parts.join(' '));
      };
    }
    G.console = {
      log: logger('log'), info: logger('info'), debug: logger('debug'), warn: logger('warn'), error: logger('error'),
      trace: logger('debug'), dir: logger('log'), table: logger('log'),
      group: logger('log'), groupCollapsed: logger('log'), groupEnd: function () {},
      time: function () {}, timeEnd: function () {}, timeLog: function () {}, count: function () {}, countReset: function () {},
      assert: function (c) { if (!c) logger('error').apply(null, ['Assertion failed:'].concat(Array.prototype.slice.call(arguments, 1))); }
    };

    // ------------------------------------------------------------ window misc
    // window methods called without a receiver (bare addEventListener(...)) target the window
    ['addEventListener', 'removeEventListener', 'dispatchEvent'].forEach(function (k) {
      var f = EventTargetProto[k];
      G[k] = function () { return f.apply(this === undefined || this === null ? G : this, arguments); };
    });
    G.window = G;
    G.self = G;
    G.top = G;
    G.parent = G;
    G.frames = G;
    G.opener = null;
    G.name = '';
    G.closed = false;
    G.isSecureContext = false;
    G.origin = 'null';
    G.devicePixelRatio = opts.dpr || 1;
    G.innerWidth = opts.innerWidth || 1280;
    G.innerHeight = opts.innerHeight || 720;
    G.outerWidth = G.innerWidth;
    G.outerHeight = G.innerHeight + 80;
    G.screenX = 0; G.screenY = 0; G.scrollX = 0; G.scrollY = 0; G.pageXOffset = 0; G.pageYOffset = 0;
    G.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: mixEvents({ type: 'landscape-primary', angle: 0, lock: function () { return Promise.reject(new Error('unsupported')); }, unlock: function () {} }) };
    G.visualViewport = mixEvents({ width: G.innerWidth, height: G.innerHeight, scale: 1, offsetLeft: 0, offsetTop: 0 });
    var HANDLERS = ['onerror', 'onunhandledrejection', 'onresize', 'onblur', 'onfocus', 'onkeydown', 'onkeyup', 'onkeypress',
      'onmousedown', 'onmouseup', 'onmousemove', 'onpointerdown', 'onpointerup', 'onpointermove', 'onpointercancel', 'onwheel',
      'ontouchstart', 'ontouchend', 'ontouchmove', 'onhashchange', 'onbeforeunload', 'onunload', 'onpagehide', 'onpageshow',
      'onload', 'onvisibilitychange', 'ongamepadconnected', 'ongamepaddisconnected', 'oncontextmenu', 'onclick', 'ondblclick',
      'onfocusin', 'onfocusout', 'onorientationchange', 'onmessage', 'onstorage', 'onpopstate', 'ondevicemotion'];
    for (var hi = 0; hi < HANDLERS.length; hi++) G[HANDLERS[hi]] = null;
    for (var hj = 0; hj < HANDLERS.length; hj++) document[HANDLERS[hj]] = null;
    G.matchMedia = function (q) {
      q = String(q);
      var matches = false;
      if (/prefers-reduced-motion\s*:\s*reduce/.test(q)) matches = !!opts.reducedMotion;
      else if (/prefers-color-scheme\s*:\s*dark/.test(q)) matches = true;
      else if (/\(\s*pointer\s*:\s*fine\s*\)/.test(q)) matches = true;
      else if (/min-resolution|device-pixel-ratio/.test(q)) matches = (opts.dpr || 1) > 1;
      return mixEvents({ matches: matches, media: q, onchange: null, addListener: function () {}, removeListener: function () {} });
    };
    G.getComputedStyle = function (el) {
      var st = new Style();
      st.width = (el && el.clientWidth || 0) + 'px';
      st.height = (el && el.clientHeight || 0) + 'px';
      st.getPropertyValue = function (k) { return st[k] || ''; };
      return st;
    };
    G.scrollTo = G.scroll = G.scrollBy = function () {};
    G.focus = function () {};
    G.blur = function () {};
    G.print = function () {};
    G.close = function () {};
    G.stop = function () {};
    G.moveTo = G.resizeTo = function () {};
    G.postMessage = function () {};
    G.open = function (u) { issue('network', 'window.open(' + u + ')', 'error', true); return null; };
    G.getSelection = document.getSelection;
    G.btoa = function (s) {
      s = String(s);
      for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) throw DOMException("Failed to execute 'btoa' on 'Window': The string to be encoded contains characters outside of the Latin1 range.", 'InvalidCharacterError');
      return S.base64enc(s);
    };
    G.atob = function (s) {
      s = String(s).replace(/[\t\n\f\r ]/g, '');
      if (s.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(s)) throw DOMException("Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.", 'InvalidCharacterError');
      return S.base64dec(s);
    };
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    S.base64enc = function (s) {
      var out = '', i = 0;
      while (i < s.length) {
        var a = s.charCodeAt(i++), b = s.charCodeAt(i++), c = s.charCodeAt(i++);
        var tri = (a << 16) | ((b || 0) << 8) | (c || 0);
        out += B64[(tri >> 18) & 63] + B64[(tri >> 12) & 63] + (isNaN(b) ? '=' : B64[(tri >> 6) & 63]) + (isNaN(c) ? '=' : B64[tri & 63]);
      }
      return out;
    };
    S.base64dec = function (s) {
      var out = '', buf = 0, bits = 0;
      for (var i = 0; i < s.length; i++) {
        if (s[i] === '=') break;
        buf = (buf << 6) | B64.indexOf(s[i]); bits += 6;
        if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
      }
      return out;
    };
    G.crypto = {
      getRandomValues: function (arr) { var r = S.rand || Math.random; for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(r() * 4294967296) >>> 0; return arr; },
      randomUUID: function () { return '00000000-0000-4000-8000-000000000000'; }
    };
    G.structuredClone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
    function Blob(parts, o) { this.parts = parts || []; this.type = o && o.type || ''; var n = 0; for (var i = 0; i < this.parts.length; i++) n += String(this.parts[i]).length; this.size = n; }
    Blob.prototype.text = function () { return Promise.resolve(this.parts.join('')); };
    Blob.prototype.arrayBuffer = function () { return Promise.resolve(new ArrayBuffer(this.size)); };
    Blob.prototype.slice = function () { return new Blob([]); };
    G.Blob = Blob;
    G.File = function (parts, name, o) { Blob.call(this, parts, o); this.name = name; this.lastModified = 0; };
    G.File.prototype = Object.create(Blob.prototype);
    G.FileReader = function () { mixEvents(this); this.result = null; this.readyState = 0; };
    G.FileReader.prototype.readAsText = function (b) { var self = this; Promise.resolve().then(function () { self.result = b && b.parts ? b.parts.join('') : ''; self.readyState = 2; self.dispatchEvent(new Event('load')); }); };
    G.FileReader.prototype.readAsDataURL = function () { var self = this; Promise.resolve().then(function () { self.result = 'data:,'; self.dispatchEvent(new Event('load')); }); };
    G.URL = function (u) { this.href = String(u); this.hash = ''; this.search = ''; this.searchParams = { get: function () { return null; }, has: function () { return false; } }; };
    G.URL.createObjectURL = function () { return 'blob:null/harness'; };
    G.URL.revokeObjectURL = function () {};
    G.URLSearchParams = function (s) { var map = {}; String(s || '').replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); map[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); this.get = function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; }; this.has = function (k) { return Object.prototype.hasOwnProperty.call(map, k); }; };
    G.TextEncoder = function () {}; G.TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    G.TextDecoder = function () {}; G.TextDecoder.prototype.decode = function (a) { var s = ''; if (a) for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
    G.ResizeObserver = function (cb) { this.cb = cb; }; G.ResizeObserver.prototype.observe = function () {}; G.ResizeObserver.prototype.unobserve = function () {}; G.ResizeObserver.prototype.disconnect = function () {};
    G.MutationObserver = function () {}; G.MutationObserver.prototype.observe = function () {}; G.MutationObserver.prototype.disconnect = function () {}; G.MutationObserver.prototype.takeRecords = function () { return []; };
    G.IntersectionObserver = G.ResizeObserver;
    G.MessageChannel = function () { this.port1 = mixEvents({ postMessage: function () {}, close: function () {}, start: function () {} }); this.port2 = mixEvents({ postMessage: function () {}, close: function () {}, start: function () {} }); };
    G.CSS = { supports: function () { return true; }, escape: function (s) { return String(s); } };
    G.Gamepad = function () {};

    // Virtual gamepad helper (harness API)
    S.setGamepad = function (index, pad) {
      if (!pad) { S.gamepads[index] = null; return; }
      var buttons = [], axes = [];
      for (var b = 0; b < 17; b++) { var v = pad.buttons && pad.buttons[b] ? 1 : 0; buttons.push({ pressed: !!v, touched: !!v, value: v }); }
      for (var a = 0; a < 4; a++) axes.push(pad.axes && pad.axes[a] || 0);
      S.gamepads[index] = { id: 'Harness Gamepad (STANDARD GAMEPAD)', index: index, connected: true, mapping: 'standard', timestamp: S.clock, buttons: buttons, axes: axes, vibrationActuator: null };
    };

    // Dispatch helpers for keyboard/pointer input (harness API)
    S.key = function (type, code, key) {
      var e = new KeyboardEvent(type, { code: code, key: key || code, repeat: false, bubbles: true, cancelable: true, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
      e.target = document.body;
      G.dispatchEvent(e);
      document.dispatchEvent(e);
      return e.defaultPrevented;
    };
    S.pointer = function (type, x, y, target) {
      var e = new PointerEvent(type, { clientX: x, clientY: y, pageX: x, pageY: y, offsetX: x, offsetY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true });
      e.target = target || document.getElementById('game') || document.body;
      if (e.target.dispatchEvent) e.target.dispatchEvent(e);
      G.dispatchEvent(e);
      document.dispatchEvent(e);
    };
    S.visibility = function (hidden) {
      document.hidden = !!hidden;
      document.visibilityState = hidden ? 'hidden' : 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      G.dispatchEvent(new Event('visibilitychange'));
    };
    S.resize = function (w, h) {
      G.innerWidth = w; G.innerHeight = h;
      G.dispatchEvent(new Event('resize'));
    };
    return S;
  };
})(globalThis);
