'use strict';

// Atlas Market frontend. Plain JavaScript, no build step.
// Every call goes to /api on the same origin:
//   Docker Compose: nginx in this container proxies /api to the gateway.
//   Kubernetes:     the Ingress routes /api to the gateway directly.

const state = {
  products: [],
  category: 'all',
  cart: loadCart(),     // { [productId]: quantity }
  lastOrder: null,
};

const $ = (sel) => document.querySelector(sel);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadCart() {
  try { return JSON.parse(localStorage.getItem('atlas-cart')) || {}; } catch { return {}; }
}
function saveCart() {
  try { localStorage.setItem('atlas-cart', JSON.stringify(state.cart)); } catch { /* private mode */ }
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { body, headers: res.headers };
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function friendlyError(err) {
  if (err.status === 429) return 'Too many requests. Wait a moment and try again.';
  if (err.status === 409 && err.body) {
    const p = state.products.find((x) => x.id === err.body.product_id);
    return `Only ${err.body.available} left of ${p ? p.name : 'one item'}. Your cart was adjusted.`;
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) return 'The shop is having a moment. Please try again.';
  return `Something went wrong (${err.message}).`;
}

/* ---------- Products ---------- */

async function loadProducts() {
  try {
    const { body, headers } = await api('/products');
    state.products = body;
    const cache = headers.get('x-cache');
    $('#status-cache').textContent = cache ? `catalogue cache: ${cache}` : '';
    renderFilters();
    renderProducts();
    renderCart();
  } catch (err) {
    $('#products').innerHTML = `<p class="muted">Could not load products. ${esc(friendlyError(err))}</p>`;
  }
}

function renderFilters() {
  const cats = ['all', ...new Set(state.products.map((p) => p.category))];
  $('#filters').innerHTML = cats
    .map((c) => `<button class="chip${c === state.category ? ' active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`)
    .join('');
}

function renderProducts() {
  const list = state.category === 'all' ? state.products : state.products.filter((p) => p.category === state.category);
  if (!list.length) { $('#products').innerHTML = '<p class="muted">Nothing here yet.</p>'; return; }
  $('#products').innerHTML = list.map((p) => {
    const inCart = state.cart[p.id] || 0;
    const left = p.stock - inCart;
    const stockLabel = p.stock === 0 ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : `${p.stock} in stock`;
    return `
      <article class="card">
        <div class="card-art" style="--hue:${Number(p.hue)}" aria-hidden="true">${esc(p.emoji)}</div>
        <div class="card-body">
          <span class="card-cat">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <span class="stock${p.stock <= 5 ? ' low' : ''}">${stockLabel}${inCart ? ` · ${inCart} in your cart` : ''}</span>
          <div class="card-foot">
            <span class="price">${money(p.price_cents)}</span>
            <button class="primary" data-add="${p.id}" type="button" ${left <= 0 ? 'disabled' : ''}>Add to cart</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

/* ---------- Cart ---------- */

function cartLines() {
  return Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.products.find((p) => p.id === Number(id)), qty }))
    .filter((l) => l.product && l.qty > 0);
}

function setQty(id, qty) {
  const product = state.products.find((p) => p.id === id);
  const max = product ? Math.min(product.stock, 20) : 20;
  const next = Math.max(0, Math.min(qty, max));
  if (next === 0) delete state.cart[id]; else state.cart[id] = next;
  saveCart();
  renderCart();
  renderProducts();
}

function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((n, l) => n + l.qty, 0);
  $('#cart-count').textContent = count;

  if (state.lastOrder) {
    const o = state.lastOrder;
    $('#cart-body').innerHTML = `
      <div class="success">
        <div class="big">🎉</div>
        <h2>Order #${o.id} confirmed</h2>
        <p class="muted">Thanks, ${esc(o.customer_name)}. Total ${money(o.total_cents)}.</p>
        <button class="ghost" id="continue" type="button">Keep shopping</button>
      </div>`;
    return;
  }
  if (!lines.length) {
    $('#cart-body').innerHTML = '<div class="empty">Your cart is empty.</div>';
    return;
  }
  const total = lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0);
  $('#cart-body').innerHTML = `
    ${lines.map(({ product: p, qty }) => `
      <div class="line">
        <div class="line-art" style="--hue:${Number(p.hue)}">${esc(p.emoji)}</div>
        <div>
          <div>${esc(p.name)}</div>
          <div class="qty">
            <button type="button" data-qty="${p.id}" data-delta="-1" aria-label="Remove one">−</button>
            <span>${qty}</span>
            <button type="button" data-qty="${p.id}" data-delta="1" aria-label="Add one" ${qty >= p.stock ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="price">${money(p.price_cents * qty)}</div>
      </div>`).join('')}
    <div class="totals"><span>Total</span><span>${money(total)}</span></div>
    <form class="checkout" id="checkout">
      <label>Name<input name="name" required maxlength="100" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
      <button class="primary" type="submit">Place order · ${money(total)}</button>
    </form>`;
}

async function placeOrder(form) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Placing order…';
  const payload = {
    customer_name: form.name.value,
    customer_email: form.email.value,
    items: cartLines().map((l) => ({ product_id: l.product.id, quantity: l.qty })),
  };
  try {
    const { body } = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
    state.cart = {};
    saveCart();
    state.lastOrder = body;
    renderCart();
    toast(`Order #${body.id} placed`);
    loadProducts();
  } catch (err) {
    toast(friendlyError(err), true);
    if (err.status === 409 && err.body) {
      await loadProducts();
      setQty(err.body.product_id, err.body.available);
    } else {
      renderCart();
    }
  }
}

function openCart() { $('#cart').classList.add('open'); $('#cart').setAttribute('aria-hidden', 'false'); }
function closeCart() {
  $('#cart').classList.remove('open');
  $('#cart').setAttribute('aria-hidden', 'true');
  if (state.lastOrder) { state.lastOrder = null; renderCart(); }
}

/* ---------- Orders ---------- */

async function loadOrders() {
  $('#orders').innerHTML = '<p class="muted">Loading orders…</p>';
  try {
    const { body } = await api('/orders?limit=20');
    if (!body.length) { $('#orders').innerHTML = '<p class="muted">No orders yet. Go buy something nice.</p>'; return; }
    $('#orders').innerHTML = body.map((o) => `
      <div class="order">
        <div class="order-head">
          <strong>Order #${o.id}</strong>
          <span class="pill">${esc(o.status)}</span>
        </div>
        <div class="muted">${esc(o.customer_name)} · ${new Date(o.created_at).toLocaleString()} · <b>${money(o.total_cents)}</b></div>
        <ul>${o.items.map((i) => `<li>${i.quantity} × ${esc(i.name)} @ ${money(i.unit_price_cents)}</li>`).join('')}</ul>
      </div>`).join('');
  } catch (err) {
    $('#orders').innerHTML = `<p class="muted">Could not load orders. ${esc(friendlyError(err))}</p>`;
  }
}

/* ---------- Routing + status ---------- */

function route() {
  const view = location.hash === '#/orders' ? 'orders' : 'shop';
  $('#view-shop').hidden = view !== 'shop';
  $('#view-orders').hidden = view !== 'orders';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  if (view === 'orders') loadOrders();
}

async function checkGateway() {
  try {
    const { body } = await api('/health');
    $('#status-gateway').textContent = `gateway ${body.version} · ${body.hostname || 'local'}`;
  } catch {
    $('#status-gateway').textContent = 'gateway: unreachable';
  }
}

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.cat) { state.category = t.dataset.cat; renderFilters(); renderProducts(); }
  else if (t.dataset.add) {
    const id = Number(t.dataset.add);
    setQty(id, (state.cart[id] || 0) + 1);
    const p = state.products.find((x) => x.id === id);
    toast(`${p ? p.name : 'Item'} added to cart`);
  }
  else if (t.dataset.qty) setQty(Number(t.dataset.qty), (state.cart[t.dataset.qty] || 0) + Number(t.dataset.delta));
  else if (t.id === 'cart-open') openCart();
  else if (t.id === 'cart-close' || t.id === 'continue') closeCart();
  else if (t.id === 'orders-refresh') loadOrders();
});
$('#cart').addEventListener('click', (e) => { if (e.target.id === 'cart') closeCart(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });
document.addEventListener('submit', (e) => {
  if (e.target.id === 'checkout') { e.preventDefault(); placeOrder(e.target); }
});
window.addEventListener('hashchange', route);

route();
loadProducts();
checkGateway();
