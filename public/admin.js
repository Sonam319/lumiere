(function () {
  'use strict';

  var STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

  function $(id) { return document.getElementById(id); }

  var loginView = $('login-view');
  var dashboard = $('dashboard');
  var loginForm = $('login-form');
  var loginStatus = $('login-status');
  var adminStatus = $('admin-status');
  var ordersEl = $('orders');
  var messagesEl = $('messages');

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
    return '$' + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
  }

  function when(text) {
    var d = new Date(String(text).replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? String(text) : d.toLocaleString();
  }

  function api(path, options) {
    var settings = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options);
    return fetch(path, settings).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Request failed.');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('Could not reach the server. Is it running?');
    });
  }

  function show(view) {
    loginView.hidden = view !== 'login';
    dashboard.hidden = view !== 'dashboard';
  }

  function say(target, text, kind) {
    target.className = 'form-status' + (kind ? ' ' + kind : '');
    target.textContent = text || '';
  }

  function renderStats(stats) {
    $('stat-orders').textContent = String(stats.orders);
    $('stat-pending').textContent = String(stats.pending);
    $('stat-sales').textContent = money(stats.salesCents);
  }

  function orderCard(o) {
    var select = el('select', { 'aria-label': 'Status for ' + o.order_number }, STATUSES.map(function (s) {
      var opt = el('option', { value: s }, [s]);
      if (s === o.status) opt.selected = true;
      return opt;
    }));

    select.addEventListener('change', function () {
      say(adminStatus, '');
      api('/api/admin/orders/' + o.id + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: select.value })
      }).then(function () {
        return api('/api/admin/stats').then(renderStats);
      }).catch(function (err) {
        say(adminStatus, err.message, 'error');
        load();
      });
    });

    var lines = el('ul', { class: 'order-lines' }, o.items.map(function (item) {
      return el('li', {}, [
        el('span', {}, [item.qty + ' \u00D7 ' + item.name]),
        el('span', {}, [money(item.unit_price_cents * item.qty)])
      ]);
    }));

    var card = el('article', { class: 'admin-card' }, [
      el('div', { class: 'admin-card-head' }, [el('h3', {}, [o.order_number]), select]),
      el('p', { class: 'admin-meta' }, [when(o.created_at)]),
      el('p', {}, ['Customer: ' + o.customer_name]),
      el('p', {}, ['Phone: ' + o.phone]),
      el('p', {}, ['Email: ' + (o.email || 'not given')]),
      el('p', {}, ['Address: ' + o.address]),
      el('p', {}, ['Payment: ' + (o.payment_method === 'cod' ? 'Cash on delivery' : 'Bank transfer')])
    ]);
    if (o.notes) card.appendChild(el('p', {}, ['Notes: ' + o.notes]));
    card.appendChild(lines);
    card.appendChild(el('p', {}, [el('strong', {}, ['Total: ' + money(o.total_cents)])]));
    return card;
  }

  function renderOrders(orders) {
    ordersEl.textContent = '';
    if (!orders.length) {
      ordersEl.appendChild(el('p', {}, ['No orders yet.']));
      return;
    }
    orders.forEach(function (o) { ordersEl.appendChild(orderCard(o)); });
  }

  function renderMessages(messages) {
    messagesEl.textContent = '';
    if (!messages.length) {
      messagesEl.appendChild(el('p', {}, ['No messages yet.']));
      return;
    }
    messages.forEach(function (m) {
      messagesEl.appendChild(el('article', { class: 'admin-card' }, [
        el('div', { class: 'admin-card-head' }, [el('h3', {}, [m.name + ' (' + m.email + ')'])]),
        el('p', { class: 'admin-meta' }, [m.topic + ' \u00B7 ' + when(m.created_at)]),
        el('p', { class: 'admin-message' }, [m.message])
      ]));
    });
  }

  function load() {
    return Promise.all([
      api('/api/admin/orders'),
      api('/api/admin/messages'),
      api('/api/admin/stats')
    ]).then(function (r) {
      renderOrders(r[0].orders);
      renderMessages(r[1].messages);
      renderStats(r[2]);
      say(adminStatus, '');
      show('dashboard');
    }).catch(function (err) {
      if (err.status === 401) {
        show('login');
      } else if (err.status === 503) {
        show('login');
        say(loginStatus, err.message, 'error');
      } else {
        say(dashboard.hidden ? loginStatus : adminStatus, err.message, 'error');
      }
    });
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    say(loginStatus, '');

    var username = $('username').value.trim();
    var password = $('password').value;
    if (!username || !password) {
      say(loginStatus, 'Please enter your username and password.', 'error');
      return;
    }

    var button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Signing in\u2026';

    api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: username, password: password })
    }).then(function () {
      $('password').value = '';
      return load();
    }).catch(function (err) {
      $('password').value = '';
      say(loginStatus, err.message, 'error');
    }).then(function () {
      button.disabled = false;
      button.textContent = 'Sign in';
    });
  });

  $('refresh').addEventListener('click', load);

  $('logout').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).catch(function () {}).then(function () {
      ordersEl.textContent = '';
      messagesEl.textContent = '';
      say(loginStatus, 'You have been signed out.', 'success');
      show('login');
    });
  });

  /* If you are already signed in, go straight to the dashboard */
  load();
})();