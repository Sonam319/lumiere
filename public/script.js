/* ================= LUMIERE – script.js ================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'lumiere-cart';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^[0-9+()\s-]{7,20}$/;
  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var PAGE = document.body.getAttribute('data-page') || '';

  var CART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>';

  var NAV = [
    ['home', './index.html', 'Home'],
    ['shop', './Shop.html', 'Shop'],
    ['categories', './Categories.html', 'Categories'],
    ['new', './New-Arrivals.html', 'New Arrivals'],
    ['about', './About.html', 'About'],
    ['contact', './Contact.html', 'Contact']
  ];

  /* ---------- Helpers ---------- */
  function $(id) { return document.getElementById(id); }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'class') node.className = props[key];
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function money(cents) {
    return 'Nu.' + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
  }

  function parsePriceCents(text) {
    var m = String(text).match(/[0-9]+(\.[0-9]+)?/);
    return m ? Math.round(parseFloat(m[0]) * 100) : 0;
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* Talks to the Node server */
  function api(path, options) {
    var settings = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options);
    return fetch(path, settings).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 404 || res.status === 405) {
            throw new Error('The shop server was not found. Start it with "npm start" and open http://localhost:3000.');
          }
          throw new Error(data.error || 'Something went wrong. Please try again.');
        }
        return data;
      });
    }, function () {
      throw new Error('Could not reach the shop server. Start it with "npm start" and open http://localhost:3000.');
    });
  }

  /* ---------- Form validation ---------- */
  function setFieldError(field, msg) {
    var group = field.closest('.form-group');
    var err = group.querySelector('.field-error');
    if (!err) {
      err = el('span', { class: 'field-error', id: field.id + '-error' });
      group.appendChild(err);
    }
    err.textContent = msg;
    field.classList.toggle('invalid', !!msg);
    if (msg) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', err.id);
    } else {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    }
  }

  function attachValidation(form, rules) {
    form.setAttribute('novalidate', '');

    function check(field) {
      var rule = rules[field.name];
      if (!rule) return true;
      var msg = rule(field.value);
      setFieldError(field, msg);
      return !msg;
    }

    form.addEventListener('blur', function (e) {
      if (rules[e.target.name]) check(e.target);
    }, true);

    form.addEventListener('input', function (e) {
      if (e.target.classList && e.target.classList.contains('invalid')) check(e.target);
    });

    return {
      checkAll: function () {
        var firstBad = null;
        form.querySelectorAll('input, textarea').forEach(function (field) {
          if (!check(field) && !firstBad) firstBad = field;
        });
        return firstBad;
      }
    };
  }

  /* ---------- Shared header and footer ---------- */
  function renderLayout() {
    var headerHost = $('site-header');
    if (headerHost) {
      var links = NAV.map(function (n) {
        var current = n[0] === PAGE;
        return '<a href="' + n[1] + '"' + (current ? ' class="active" aria-current="page"' : '') + '>' + n[2] + '</a>';
      }).join('');

      headerHost.insertAdjacentHTML('beforebegin',
        '<div class="announce"><p>New season collection now available <a href="./New-Arrivals.html">Shop new arrivals</a></p></div>' +
        '<header id="Header" class="site-header' + (PAGE === 'home' ? ' overlay' : '') + '"><div class="bar">' +
          '<a class="logo" href="./index.html">LUMIERE</a>' +
          '<nav id="site-nav" aria-label="Main">' + links + '</nav>' +
          '<div class="header-actions">' +
            '<a class="cart-btn" href="./cart.html" aria-label="Cart, 0 items">' + CART_ICON + '<span class="cart-count" hidden>0</span></a>' +
            '<button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>' +
          '</div>' +
        '</div></header>');
      headerHost.remove();
    }

    var footerHost = $('site-footer');
    if (footerHost) {
      footerHost.insertAdjacentHTML('beforebegin',
        '<footer class="site-footer on-dark">' +
          '<div class="footer-grid">' +
            '<div class="footer-brand"><a class="logo" href="./index.html">LUMIERE</a><p>Timeless style. Thoughtful details. Made for you.</p></div>' +
            '<div><h3>Shop</h3><ul>' +
              '<li><a href="./Shop.html">All products</a></li>' +
              '<li><a href="./Categories.html">Categories</a></li>' +
              '<li><a href="./New-Arrivals.html">New arrivals</a></li>' +
              '<li><a href="./cart.html">Your cart</a></li>' +
            '</ul></div>' +
            '<div><h3>Company</h3><ul>' +
              '<li><a href="./About.html">About us</a></li>' +
              '<li><a href="./Contact.html">Contact</a></li>' +
            '</ul></div>' +
            '<div><h3>Visit</h3><p>Your street, Your city</p><p>hello@lumiere.com</p><p>Monday to Saturday, 9am to 6pm</p></div>' +
          '</div>' +
          '<div class="footer-bottom"><p>&copy; ' + new Date().getFullYear() + ' LUMIERE. All rights reserved.</p><a class="admin-link" href="./admin.html">Admin login</a></div>' +
        '</footer>');
      footerHost.remove();
    }
  }

  /* ---------- Header behaviour ---------- */
  function initHeader() {
    var header = $('Header');
    if (!header) return;
    var toggle = header.querySelector('.nav-toggle');

    function onScroll() { header.classList.toggle('scrolled', window.scrollY > 10); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (!toggle) return;

    function setMenu(open) {
      header.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    toggle.addEventListener('click', function () { setMenu(!header.classList.contains('menu-open')); });
    header.querySelector('nav').addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 900) setMenu(false); });
  }

  /* ---------- Cart store (shared by every page) ---------- */
  var Cart = (function () {
    var items = load();
    var listeners = [];

    function load() {
      try {
        var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(data)) return [];
        return data.map(function (c) {
          if (c && typeof c.price === 'number' && typeof c.priceCents !== 'number') c.priceCents = Math.round(c.price * 100);
          if (c && typeof c.name === 'string' && typeof c.id !== 'string') c.id = slugify(c.name);
          return c;
        }).filter(function (c) {
          return c && typeof c.id === 'string' && ID_RE.test(c.id) && typeof c.name === 'string' &&
                 Number.isInteger(c.priceCents) && c.priceCents >= 0 && typeof c.img === 'string' &&
                 Number.isInteger(c.qty) && c.qty > 0 && c.qty <= 99;
        });
      } catch (err) {
        return [];
      }
    }

    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (err) { /* storage unavailable */ }
    }

    function emit() { listeners.forEach(function (fn) { fn(items); }); }
    function change() { persist(); emit(); }
    function find(id) { return items.filter(function (c) { return c.id === id; })[0]; }

    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) {
        items = load();
        emit();
      }
    });

    return {
      items: function () { return items; },
      find: find,
      count: function () { return items.reduce(function (s, c) { return s + c.qty; }, 0); },
      total: function () { return items.reduce(function (s, c) { return s + c.priceCents * c.qty; }, 0); },
      add: function (p) {
        var found = find(p.id);
        if (found) found.qty = Math.min(99, found.qty + 1);
        else items.push({ id: p.id, name: p.name, priceCents: p.priceCents, img: p.img, qty: 1 });
        change();
      },
      setQty: function (id, qty) {
        var found = find(id);
        if (!found) return;
        if (qty < 1) items = items.filter(function (c) { return c.id !== id; });
        else found.qty = Math.min(99, qty);
        change();
      },
      remove: function (id) {
        items = items.filter(function (c) { return c.id !== id; });
        change();
      },
      clear: function () {
        items = [];
        change();
      },
      subscribe: function (fn) {
        listeners.push(fn);
        fn(items);
      }
    };
  })();

  /* Pieces used by both the mini cart and the cart page */
  function qtyControl(item) {
    return el('div', { class: 'qty' }, [
      el('button', { type: 'button', 'data-action': 'dec', 'data-id': item.id, 'aria-label': 'Decrease quantity of ' + item.name }, ['\u2212']),
      el('span', {}, [String(item.qty)]),
      el('button', { type: 'button', 'data-action': 'inc', 'data-id': item.id, 'aria-label': 'Increase quantity of ' + item.name }, ['+'])
    ]);
  }

  function removeButton(item) {
    return el('button', { class: 'link-btn', type: 'button', 'data-action': 'remove', 'data-id': item.id, 'aria-label': 'Remove ' + item.name }, ['Remove']);
  }

  function bindLineActions(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var item = Cart.find(id);
      if (!item) return;
      var action = btn.getAttribute('data-action');

      if (action === 'inc') Cart.setQty(id, item.qty + 1);
      else if (action === 'dec') Cart.setQty(id, item.qty - 1);
      else if (action === 'remove') Cart.remove(id);

      var again = container.querySelector('[data-action="' + action + '"][data-id="' + id + '"]');
      if (again) again.focus();
    });
  }

  /* ---------- Cart button in the header ---------- */
  function initCartButton() {
    var btn = document.querySelector('.cart-btn');
    if (!btn) return null;
    var badge = btn.querySelector('.cart-count');

    Cart.subscribe(function () {
      var n = Cart.count();
      badge.textContent = String(n);
      badge.hidden = n === 0;
      btn.setAttribute('aria-label', 'Cart, ' + n + (n === 1 ? ' item' : ' items'));
    });

    return btn;
  }

  /* ---------- Slide-out mini cart ---------- */
  function initDrawer(cartBtn) {
    if (PAGE === 'cart') {
      cartBtn.addEventListener('click', function (e) { e.preventDefault(); });
      return;
    }

    var overlay = el('div', { class: 'drawer-overlay' });
    var drawer = el('aside', { class: 'drawer', id: 'cart-drawer', 'aria-labelledby': 'drawer-title', 'aria-hidden': 'true' });
    drawer.innerHTML =
      '<div class="drawer-head"><h2 id="drawer-title">Your cart</h2><button class="drawer-close" type="button" aria-label="Close cart">\u00D7</button></div>' +
      '<ul class="drawer-list"></ul>' +
      '<div class="drawer-empty">' + CART_ICON + '<p>Your cart is empty.</p><a class="btn" href="./Shop.html">Start shopping</a></div>' +
      '<div class="drawer-foot">' +
        '<div class="summary-row"><span>Subtotal</span><strong class="drawer-total">Nu.0</strong></div>' +
        '<a class="btn btn-block" href="./cart.html#delivery">Checkout</a>' +
        '<a class="btn btn-outline btn-block" href="./cart.html">View cart</a>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    var listEl = drawer.querySelector('.drawer-list');
    var emptyEl = drawer.querySelector('.drawer-empty');
    var footEl = drawer.querySelector('.drawer-foot');
    var totalEl = drawer.querySelector('.drawer-total');
    var closeBtn = drawer.querySelector('.drawer-close');
    var lastFocus = null;

    function render(items) {
      listEl.textContent = '';
      items.forEach(function (item) {
        listEl.appendChild(el('li', { class: 'drawer-item' }, [
          el('img', { src: item.img, alt: '' }),
          el('div', {}, [
            el('h3', {}, [item.name]),
            el('span', { class: 'price' }, [money(item.priceCents)]),
            el('div', { class: 'drawer-controls' }, [qtyControl(item), removeButton(item)])
          ]),
          el('strong', { class: 'row-total' }, [money(item.priceCents * item.qty)])
        ]));
      });
      listEl.hidden = items.length === 0;
      emptyEl.hidden = items.length !== 0;
      footEl.hidden = items.length === 0;
      totalEl.textContent = money(Cart.total());
    }

    function open() {
      lastFocus = document.activeElement;
      drawer.classList.add('open');
      overlay.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    }

    function close() {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    Cart.subscribe(render);
    bindLineActions(listEl);

    cartBtn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });

    /* Keep Tab focus inside the open drawer */
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var focusable = Array.prototype.filter.call(
        drawer.querySelectorAll('a[href], button:not([disabled])'),
        function (node) { return node.offsetParent !== null; }
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- "Add to cart" buttons ---------- */
  function initAddToCart() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.add-btn');
      if (!btn) return;
      var card = btn.closest('.product-card');
      if (!card) return;

      var name = card.querySelector('h3').textContent.trim();
      var img = card.querySelector('.product-img img');
      Cart.add({
        id: card.getAttribute('data-id') || slugify(name),
        name: name,
        priceCents: parsePriceCents(card.querySelector('.price').textContent),
        img: img ? img.getAttribute('src') : ''
      });

      btn.classList.add('added');
      btn.textContent = 'Added \u2713';
      clearTimeout(btn._timer);
      btn._timer = setTimeout(function () {
        btn.classList.remove('added');
        btn.textContent = 'Add to cart';
      }, 1400);

      var cartBtn = document.querySelector('.cart-btn');
      if (cartBtn) {
        cartBtn.classList.remove('bump');
        void cartBtn.offsetWidth; /* restart the animation */
        cartBtn.classList.add('bump');
      }
    });
  }

  /* ---------- Cart page and checkout ---------- */
  function initCartPage() {
    var content = $('cart-content');
    if (!content) return;

    var emptyEl = $('cart-empty');
    var doneEl = $('order-done');
    var listEl = $('cart-items');
    var form = $('checkout-form');
    var placeBtn = $('place-order');
    var statusEl = $('order-status');
    var finished = false;

    function field(name) { return form.querySelector('[name="' + name + '"]'); }

    function render() {
      if (finished) return;
      var items = Cart.items();
      var has = items.length > 0;
      content.hidden = !has;
      emptyEl.hidden = has;

      listEl.textContent = '';
      items.forEach(function (item) {
        listEl.appendChild(el('li', {}, [
          el('img', { src: item.img, alt: '', width: '96', height: '120' }),
          el('div', { class: 'row-info' }, [
            el('h3', {}, [item.name]),
            el('p', {}, [money(item.priceCents) + ' each']),
            removeButton(item)
          ]),
          qtyControl(item),
          el('strong', { class: 'row-total' }, [money(item.priceCents * item.qty)])
        ]));
      });

      $('sum-count').textContent = String(Cart.count());
      $('sum-subtotal').textContent = money(Cart.total());
      $('sum-total').textContent = money(Cart.total());
      placeBtn.disabled = !has;
    }

    Cart.subscribe(render);
    bindLineActions(listEl);
    $('clear-cart').addEventListener('click', function () { Cart.clear(); });

    var validator = attachValidation(form, {
      name: function (v) { return v.trim().length >= 2 ? '' : 'Please enter your name.'; },
      phone: function (v) { return PHONE_RE.test(v.trim()) ? '' : 'Please enter a valid phone number.'; },
      email: function (v) { return !v.trim() || EMAIL_RE.test(v.trim()) ? '' : 'Please enter a valid email address.'; },
      address: function (v) { return v.trim().length >= 8 ? '' : 'Please enter your full delivery address.'; }
    });

    function showDone(data) {
      finished = true;
      Cart.clear();
      content.hidden = true;
      emptyEl.hidden = true;
      doneEl.hidden = false;

      $('done-number').textContent = data.orderNumber;
      var lines = $('done-items');
      lines.textContent = '';
      data.items.forEach(function (line) {
        lines.appendChild(el('li', {}, [
          el('span', {}, [line.qty + ' \u00D7 ' + line.name]),
          el('span', {}, [money(line.lineTotalCents)])
        ]));
      });
      $('done-total').textContent = money(data.totalCents);
      $('done-note').textContent = data.paymentMethod === 'bank'
        ? 'We will contact you with bank transfer details. Please keep your order number.'
        : 'Please have the amount ready when your order is delivered. Please keep your order number.';

      window.scrollTo({ top: 0 });
      $('done-title').focus();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      statusEl.className = 'form-status';
      statusEl.textContent = '';

      var firstBad = validator.checkAll();
      if (firstBad) {
        firstBad.focus();
        statusEl.classList.add('error');
        statusEl.textContent = 'Please fix the highlighted fields.';
        return;
      }
      if (!Cart.items().length) return;

      placeBtn.disabled = true;
      placeBtn.textContent = 'Placing order\u2026';

      api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            name: field('name').value,
            phone: field('phone').value,
            email: field('email').value,
            address: field('address').value,
            notes: field('notes').value
          },
          paymentMethod: field('payment').value,
          items: Cart.items().map(function (c) { return { id: c.id, qty: c.qty }; })
        })
      }).then(function (data) {
        form.reset();
        showDone(data);
      }).catch(function (err) {
        statusEl.classList.add('error');
        statusEl.textContent = err.message;
      }).then(function () {
        placeBtn.disabled = Cart.items().length === 0;
        placeBtn.textContent = 'Place order';
      });
    });
  }

  /* ---------- Hero video ---------- */
  function initHeroVideo() {
    var video = document.querySelector('.hero-video');
    if (!video) return;
    var btn = document.querySelector('.hero-toggle');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function sync() {
      if (btn) btn.textContent = video.paused ? 'Play video' : 'Pause video';
    }

    if (reduce) {
      video.removeAttribute('autoplay');
      video.pause();
    } else {
      var started = video.play();
      if (started && started.catch) started.catch(sync);
    }

    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);

    if (btn) {
      btn.addEventListener('click', function () {
        if (video.paused) {
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          video.pause();
        }
      });
    }
    sync();
  }

  /* ---------- Shop: filter, sort and count ---------- */
  function initShop() {
    var grid = $('shop-grid');
    if (!grid) return;

    var cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
    var pills = document.querySelectorAll('.filter-bar [data-filter]');
    var sortEl = $('sort');
    var countEl = $('result-count');
    var current = 'all';

    function priceOf(card) { return parsePriceCents(card.querySelector('.price').textContent); }
    function nameOf(card) { return card.querySelector('h3').textContent.trim().toLowerCase(); }

    function apply() {
      var visible = 0;
      cards.forEach(function (card) {
        var show = current === 'all' || card.getAttribute('data-category') === current;
        card.hidden = !show;
        if (show) visible++;
      });

      var mode = sortEl ? sortEl.value : 'featured';
      var ordered = cards.slice();
      if (mode === 'price-asc') ordered.sort(function (a, b) { return priceOf(a) - priceOf(b); });
      else if (mode === 'price-desc') ordered.sort(function (a, b) { return priceOf(b) - priceOf(a); });
      else if (mode === 'name') ordered.sort(function (a, b) { return nameOf(a) < nameOf(b) ? -1 : 1; });
      ordered.forEach(function (card) { grid.appendChild(card); });

      countEl.textContent = visible + (visible === 1 ? ' product' : ' products');
    }

    function select(filter) {
      current = filter;
      pills.forEach(function (pill) {
        var on = pill.getAttribute('data-filter') === filter;
        pill.classList.toggle('active', on);
        pill.setAttribute('aria-pressed', String(on));
      });
      apply();
    }

    pills.forEach(function (pill) {
      pill.addEventListener('click', function () { select(pill.getAttribute('data-filter')); });
    });
    if (sortEl) sortEl.addEventListener('change', apply);

    /* Links such as Shop.html?cat=handbags open with that filter selected */
    var wanted = new URLSearchParams(window.location.search).get('cat');
    var valid = Array.prototype.some.call(pills, function (p) { return p.getAttribute('data-filter') === wanted; });
    select(valid ? wanted : 'all');
  }

  /* ---------- Contact form ---------- */
  function initContactForm() {
    var form = $('contact-form');
    if (!form) return;

    var status = $('contact-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    var validator = attachValidation(form, {
      name: function (v) { return v.trim().length >= 2 ? '' : 'Please enter your name.'; },
      email: function (v) { return EMAIL_RE.test(v.trim()) ? '' : 'Please enter a valid email address.'; },
      message: function (v) { return v.trim().length >= 10 ? '' : 'Please write at least 10 characters.'; }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';

      var firstBad = validator.checkAll();
      if (firstBad) {
        firstBad.focus();
        status.classList.add('error');
        status.textContent = 'Please fix the highlighted fields.';
        return;
      }

      var nameValue = form.querySelector('[name="name"]').value.trim();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending\u2026';

      api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: nameValue,
          email: form.querySelector('[name="email"]').value,
          topic: form.querySelector('[name="topic"]').value,
          message: form.querySelector('[name="message"]').value
        })
      }).then(function () {
        form.reset();
        status.classList.add('success');
        status.textContent = 'Thank you, ' + nameValue.split(' ')[0] + '. We will get back to you within one working day.';
      }).catch(function (err) {
        status.classList.add('error');
        status.textContent = err.message;
      }).then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message';
      });
    });
  }

  /* ---------- Fade-in on scroll ---------- */
  function initReveal() {
    if (!('IntersectionObserver' in window)) return;
    var items = document.querySelectorAll('.product-card, .category-tile, .value, .section-head, .split > *, .contact-layout > *, .strip-item');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    items.forEach(function (item) {
      item.classList.add('reveal');
      observer.observe(item);
    });
  }

  /* ---------- Start ---------- */
  renderLayout();
  initHeader();
  var cartBtn = initCartButton();
  if (cartBtn) initDrawer(cartBtn);
  initAddToCart();
  initHeroVideo();
  initShop();
  initContactForm();
  initCartPage();
  initReveal();
})();
