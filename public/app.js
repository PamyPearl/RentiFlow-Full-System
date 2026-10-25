const page = document.querySelector('[data-page]')?.dataset.page;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const formatPrice = (amount) => `GH₵${Number(amount).toLocaleString('en-GH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const authHeaders = (token = localStorage.getItem('rentiflow_token')) => ({ Authorization: `Bearer ${token}` });
const apiRequest = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
};
const setMessage = (element, message, kind = 'info') => {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden', 'text-red-800', 'text-green-800', 'text-stone-500');
  element.classList.add(kind === 'error' ? 'text-red-800' : kind === 'success' ? 'text-green-800' : 'text-stone-500');
};
const emptyState = (message) => `<p class="rounded-lg border border-dashed border-stone-300 p-5 text-sm text-stone-500">${escapeHtml(message)}</p>`;
const applicationStatusLabel = (status) => ({ information_requested: 'Information requested' })[status] || String(status || '').replaceAll('_', ' ');
const renderApplicationHistory = (events) => events?.length ? `<ol class="mt-4 grid gap-2 border-l border-stone-200 pl-4">${events.map((event) => `<li class="text-xs text-stone-600"><span class="font-semibold">${escapeHtml(applicationStatusLabel(event.toStatus))}</span><span class="ml-2">${escapeHtml(new Date(event.createdAt).toLocaleDateString())}</span>${event.reason ? `<p class="mt-1">${escapeHtml(event.reason)}</p>` : ''}</li>`).join('')}</ol>` : '';
const toggle = document.querySelector('[data-action="toggle-menu"]');
if (toggle) toggle.addEventListener('click', () => {
  const nav = document.querySelector('#main-navigation');
  nav.classList.toggle('hidden'); nav.classList.toggle('absolute'); nav.classList.toggle('top-20'); nav.classList.toggle('left-5'); nav.classList.toggle('right-5'); nav.classList.toggle('z-20'); nav.classList.toggle('grid'); nav.classList.toggle('rounded-md'); nav.classList.toggle('bg-white'); nav.classList.toggle('p-5');
  toggle.setAttribute('aria-expanded', String(!nav.classList.contains('hidden')));
});
const rolePage = { tenant: '/tenant.html', landlord: '/landlord.html', administrator: '/admin.html' };
async function requireRole(role) {
  const token = localStorage.getItem('rentiflow_token');
  if (!token) { location.assign('/login.html'); return null; }
  try {
    const { user } = await apiRequest('/api/v1/auth/me', { headers: authHeaders(token) });
    if (user.role !== role) { location.assign(rolePage[user.role] || '/login.html'); return null; }
    const welcome = document.querySelector('#welcome-user');
    if (welcome) welcome.textContent = `Signed in as ${user.first_name} ${user.last_name}`;
    return { token, user };
  } catch {
    localStorage.removeItem('rentiflow_token');
    location.assign('/login.html');
    return null;
  }
}
document.querySelectorAll('[data-action="logout"]').forEach((button) => button.addEventListener('click', () => {
  localStorage.removeItem('rentiflow_token'); location.assign('/');
}));

async function loadProperties() {
  const grid = document.querySelector('#listing-grid');
  const form = document.querySelector('#search-form');
  const params = new URLSearchParams(location.search);
  const locationField = document.querySelector('#location-filter');
  const typeField = document.querySelector('#type-filter');
  const budgetField = document.querySelector('#budget-filter');
  if (locationField) locationField.value = params.get('location') || '';
  if (typeField) typeField.value = params.get('type') || '';
  if (budgetField) budgetField.value = params.get('maxRent') || '';
  const render = (items) => {
    grid.innerHTML = items.map((item) => {
      const image = /^https:\/\//i.test(item.image_url || '') ? `<img class="h-full w-full object-cover" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}, ${escapeHtml(item.location)}" loading="lazy">` : '<div class="h-full bg-sage" role="img" aria-label="Property image unavailable"></div>';
      return `<article class="overflow-hidden rounded-xl border border-stone-200 bg-white"><div class="h-56">${image}</div><div class="p-5"><h3 class="text-lg font-semibold">${escapeHtml(item.title)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.location)}</p><div class="mt-4 flex gap-4 border-b border-stone-100 pb-4 text-xs text-stone-500"><span>${Number(item.bedrooms)} beds</span><span>${Number(item.bathrooms)} baths</span>${item.size_square_metres ? `<span>${escapeHtml(item.size_square_metres)} m²</span>` : ''}</div><div class="flex items-center justify-between pt-4"><strong>${formatPrice(item.monthly_rent_ghs)} <span class="text-xs font-normal text-stone-500">/ month</span></strong><a class="text-sm font-semibold" href="/property.html?id=${encodeURIComponent(item.id)}">View home →</a></div></div></article>`;
    }).join('');
    document.querySelector('#result-count').textContent = `${items.length} published ${items.length === 1 ? 'home' : 'homes'}`;
    document.querySelector('#empty-state').classList.toggle('hidden', items.length !== 0);
    grid.classList.toggle('hidden', items.length === 0);
  };
  const search = async () => {
    const query = new URLSearchParams();
    if (locationField.value.trim()) query.set('location', locationField.value.trim());
    if (typeField.value) query.set('type', typeField.value);
    if (budgetField.value && Number(budgetField.value) > 0) query.set('maxRent', budgetField.value);
    grid.setAttribute('aria-busy', 'true');
    try {
      const data = await apiRequest(`/api/v1/properties?${query}`);
      render(data.properties);
      const suffix = query.toString();
      history.replaceState(null, '', suffix ? `?${suffix}` : location.pathname);
    } catch { grid.innerHTML = '<p class="text-sm text-red-800" role="alert">Homes could not be loaded. Check your connection and try again.</p>'; }
    finally { grid.removeAttribute('aria-busy'); }
  };
  form.addEventListener('submit', async (event) => { event.preventDefault(); await search(); });
  form.addEventListener('reset', () => setTimeout(search, 0));
  await search();
}

async function loadProperty() {
  const id = new URLSearchParams(location.search).get('id');
  const detail = document.querySelector('#property-detail');
  const section = document.querySelector('#application-section');
  const form = document.querySelector('#application-form');
  if (!id) { detail.innerHTML = emptyState('No property was selected. Browse available homes to choose one.'); return; }
  let property;
  try { ({ property } = await apiRequest(`/api/v1/properties/${encodeURIComponent(id)}`)); }
  catch (error) { detail.innerHTML = `<p class="text-sm text-red-800" role="alert">${escapeHtml(error.message)}</p>`; return; }
  const image = /^https:\/\//i.test(property.image_url || '') ? `<img class="max-h-[460px] w-full rounded-lg object-cover" src="${escapeHtml(property.image_url)}" alt="${escapeHtml(property.title)}, ${escapeHtml(property.location)}">` : '';
  detail.innerHTML = `${image}<p class="eyebrow mt-6">Published rental</p><h1 class="display-heading mt-2 text-4xl">${escapeHtml(property.title)}</h1><p class="mt-3 text-sm text-stone-500">${escapeHtml(property.location)}</p><p class="mt-6 text-base leading-7 text-stone-700">${escapeHtml(property.description)}</p><div class="mt-6 flex flex-wrap gap-5 border-y border-stone-200 py-5 text-sm text-stone-600"><span>${Number(property.bedrooms)} bedrooms</span><span>${Number(property.bathrooms)} bathrooms</span>${property.size_square_metres ? `<span>${escapeHtml(property.size_square_metres)} m²</span>` : ''}</div><p class="mt-5 text-2xl font-semibold">${formatPrice(property.monthly_rent_ghs)} <span class="text-sm font-normal text-stone-500">per month</span></p>`;
  section.classList.remove('hidden');
  const token = localStorage.getItem('rentiflow_token');
  if (!token) { form.classList.add('hidden'); document.querySelector('#apply-signin').classList.remove('hidden'); return; }
  try {
    const { user } = await apiRequest('/api/v1/auth/me', { headers: authHeaders(token) });
    if (user.role !== 'tenant') { section.classList.add('hidden'); return; }
  } catch { localStorage.removeItem('rentiflow_token'); form.classList.add('hidden'); document.querySelector('#apply-signin').classList.remove('hidden'); return; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      await apiRequest(`/api/v1/properties/${encodeURIComponent(property.id)}/applications`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(formData(form)) });
      setMessage(document.querySelector('#application-feedback'), 'Your application has been submitted.', 'success'); form.reset();
    } catch (error) { setMessage(document.querySelector('#application-feedback'), error.message, 'error'); }
    finally { button.disabled = false; }
  });
}

async function loadAuth() {
  const login = document.querySelector('#login-form');
  const register = document.querySelector('#register-form');
  const feedback = document.querySelector('#auth-feedback');
  const tabs = document.querySelectorAll('[data-auth-tab]');
  const showTab = (name) => {
    const isRegister = name === 'register';
    login.classList.toggle('hidden', isRegister); register.classList.toggle('hidden', !isRegister);
    tabs.forEach((tab) => { tab.classList.toggle('border-b-2', tab.dataset.authTab === name); tab.classList.toggle('font-semibold', tab.dataset.authTab === name); });
    feedback.classList.add('hidden');
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.authTab)));
  if (new URLSearchParams(location.search).get('mode') === 'register') showTab('register');
  const finish = (user, token) => { localStorage.setItem('rentiflow_token', token); location.assign(rolePage[user.role] || '/'); };
  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const data = await apiRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(formData(login)) }); finish(data.user, data.token); }
    catch (error) { setMessage(feedback, error.message, 'error'); }
  });
  register.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const data = await apiRequest('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(formData(register)) }); finish(data.user, data.token); }
    catch (error) { setMessage(feedback, error.message, 'error'); }
  });
}

async function loadTenant() {
  const session = await requireRole('tenant'); if (!session) return;
  const { token } = session;
  const [applications, verification] = await Promise.all([
    apiRequest('/api/v1/properties/applications/me', { headers: authHeaders(token) }),
    apiRequest('/api/v1/verification/me', { headers: authHeaders(token) })
  ]);
  document.querySelector('#application-count').textContent = applications.applications.length;
  document.querySelector('#applications-list').innerHTML = applications.applications.length ? applications.applications.map((item) => `<article class="rounded-lg border border-stone-200 p-4"><div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="font-semibold">${escapeHtml(item.title)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.location)}</p></div><span class="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">${escapeHtml(applicationStatusLabel(item.status))}</span></div>${renderApplicationHistory(item.history)}</article>`).join('') : emptyState('You have no applications yet. Explore a published home to begin.');
  const latest = verification.submissions[0];
  document.querySelector('#verification-status').textContent = latest ? `Status: ${latest.status.replaceAll('_', ' ')} · Method: simulated manual review` : 'No submission yet. Only submit a synthetic reference.';
  const verifyForm = document.querySelector('#verification-form');
  verifyForm.classList.toggle('hidden', Boolean(latest && ['submitted', 'under_review'].includes(latest.status)));
  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await apiRequest('/api/v1/verification/submissions', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(formData(verifyForm)) });
      document.querySelector('#verification-status').textContent = `Status: ${data.submission.status} · Method: simulated manual review`;
      verifyForm.classList.add('hidden'); setMessage(document.querySelector('#verification-feedback'), 'Submission recorded for simulated manual review.', 'success');
    } catch (error) { setMessage(document.querySelector('#verification-feedback'), error.message, 'error'); }
  });
}

async function loadLandlord() {
  const session = await requireRole('landlord'); if (!session) return;
  const { token, user } = session;
  const propertyForm = document.querySelector('#property-form');
  const propertyFeedback = document.querySelector('#property-feedback');
  let editingPropertyId = null;
  let ownedProperties = [];
  const resetPropertyEditor = () => {
    editingPropertyId = null;
    propertyForm.reset();
    document.querySelector('#property-form-heading').textContent = 'Submit a property';
    document.querySelector('#property-submit-button').textContent = 'Submit for review';
    document.querySelector('#property-edit-cancel').classList.add('hidden');
  };
  const load = async () => {
    const [data, applicationData] = await Promise.all([
      apiRequest('/api/v1/properties/owned', { headers: authHeaders(token) }),
      apiRequest('/api/v1/properties/landlord/applications', { headers: authHeaders(token) })
    ]);
    ownedProperties = data.properties;
    document.querySelector('#property-count').textContent = data.properties.length;
    document.querySelector('#properties-list').innerHTML = data.properties.length ? data.properties.map((item) => {
      const archived = item.status === 'archived';
      const history = (item.history || []).slice(-3).reverse().map((event) => `<li>${escapeHtml(event.eventType.replaceAll('_', ' '))} · ${escapeHtml(new Date(event.createdAt).toLocaleDateString())}</li>`).join('');
      return `<article data-property-id="${escapeHtml(item.id)}" class="rounded-lg border border-stone-200 p-4"><div class="flex items-start justify-between gap-3"><div><h3 class="font-semibold">${escapeHtml(item.title)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.location)} · ${formatPrice(item.monthly_rent_ghs)}/month</p></div><span class="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">${escapeHtml(item.status.replaceAll('_', ' '))}</span></div><p class="mt-2 text-sm text-stone-600">${item.is_available ? 'Available' : 'Unavailable'}${item.available_from ? ` from ${escapeHtml(new Date(`${item.available_from.slice(0, 10)}T00:00:00`).toLocaleDateString())}` : ''}</p>${archived ? '' : `<div class="mt-4 flex flex-wrap items-end gap-3"><label class="flex items-center gap-2 text-sm"><input type="checkbox" data-availability-toggle ${item.is_available ? 'checked' : ''}> Available for rent</label><label class="grid gap-1 text-xs text-stone-500">Available from<input data-available-from type="date" value="${escapeHtml(item.available_from ? item.available_from.slice(0, 10) : '')}" class="field rounded-md border border-stone-300 p-2 text-sm"></label><button class="button-secondary" data-save-availability>Save availability</button></div><div class="mt-4 flex flex-wrap gap-2"><button class="button-secondary" data-edit-property>Edit listing</button><button class="button-secondary" data-archive-property>Archive listing</button></div>`}${history ? `<details class="mt-4 text-xs text-stone-500"><summary class="cursor-pointer font-semibold">Listing history</summary><ol class="mt-2 grid gap-1">${history}</ol></details>` : ''}</article>`;
    }).join('') : emptyState('No listings yet. Submit your first property above.');
    document.querySelector('#landlord-applications-list').innerHTML = applicationData.applications.length ? applicationData.applications.map((item) => `<article data-application-id="${escapeHtml(item.id)}" class="rounded-lg border border-stone-200 p-4"><div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">${escapeHtml(item.title)} · ${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.email)}</p><p class="mt-2 text-sm">${escapeHtml(item.message)}</p></div><span class="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">${escapeHtml(applicationStatusLabel(item.status))}</span></div>${['submitted', 'under_review', 'information_requested', 'shortlisted'].includes(item.status) ? `<div class="mt-4 flex flex-wrap gap-2">${['submitted', 'information_requested'].includes(item.status) ? '<button class="button-secondary" data-application-decision="under_review">Mark in review</button>' : ''}<input class="decision-reason field max-w-sm rounded-md border border-stone-300 p-2 text-sm" aria-label="Reason required for requesting information or declining" placeholder="Reason if requesting information or declining"><button class="button-secondary" data-application-decision="information_requested">Request information</button>${item.status !== 'shortlisted' ? '<button class="button-secondary" data-application-decision="shortlisted">Shortlist</button>' : ''}<button class="button-secondary" data-application-decision="rejected">Decline</button><button class="button-primary" data-application-decision="approved">Approve</button></div>` : ''}</article>`).join('') : emptyState('There are no applications for your listings yet.');
  };
  propertyForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const propertyId = editingPropertyId;
    try {
      const result = await apiRequest(propertyId ? `/api/v1/properties/${encodeURIComponent(propertyId)}` : '/api/v1/properties', {
        method: propertyId ? 'PATCH' : 'POST', headers: authHeaders(token), body: JSON.stringify(formData(form))
      });
      resetPropertyEditor();
      setMessage(propertyFeedback, propertyId ? result.message : 'Listing submitted for review.', 'success');
      await load();
    }
    catch (error) { setMessage(document.querySelector('#property-feedback'), error.message, 'error'); }
  });
  document.querySelector('#property-edit-cancel').addEventListener('click', resetPropertyEditor);
  document.querySelector('#properties-list').addEventListener('click', async (event) => {
    const card = event.target.closest('[data-property-id]'); if (!card) return;
    const property = ownedProperties.find((item) => item.id === card.dataset.propertyId); if (!property) return;
    if (event.target.closest('[data-edit-property]')) {
      editingPropertyId = property.id;
      for (const [name, value] of Object.entries({
        title: property.title, description: property.description, location: property.location,
        propertyType: property.property_type, monthlyRentGhs: property.monthly_rent_ghs,
        bedrooms: property.bedrooms, bathrooms: property.bathrooms,
        sizeSquareMetres: property.size_square_metres ?? '', imageUrl: property.image_url ?? ''
      })) propertyForm.elements.namedItem(name).value = value;
      document.querySelector('#property-form-heading').textContent = 'Edit property listing';
      document.querySelector('#property-submit-button').textContent = 'Save changes';
      document.querySelector('#property-edit-cancel').classList.remove('hidden');
      propertyForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (event.target.closest('[data-save-availability]')) {
      try {
        await apiRequest(`/api/v1/properties/${encodeURIComponent(property.id)}/availability`, {
          method: 'PATCH', headers: authHeaders(token),
          body: JSON.stringify({ isAvailable: card.querySelector('[data-availability-toggle]').checked, availableFrom: card.querySelector('[data-available-from]').value || null })
        });
        setMessage(propertyFeedback, 'Availability updated.', 'success'); await load();
      } catch (error) { setMessage(propertyFeedback, error.message, 'error'); }
      return;
    }
    if (event.target.closest('[data-archive-property]')) {
      if (!window.confirm(`Archive “${property.title}”? It will be removed from public search.`)) return;
      try {
        await apiRequest(`/api/v1/properties/${encodeURIComponent(property.id)}/archive`, { method: 'POST', headers: authHeaders(token) });
        setMessage(propertyFeedback, 'Listing archived.', 'success'); await load();
      } catch (error) { setMessage(propertyFeedback, error.message, 'error'); }
    }
  });
  document.querySelector('#landlord-applications-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-application-decision]'); if (!button) return;
    const reason = ['rejected', 'information_requested'].includes(button.dataset.applicationDecision) ? button.parentElement.querySelector('.decision-reason').value.trim() : null;
    try { await apiRequest(`/api/v1/properties/applications/${encodeURIComponent(button.closest('[data-application-id]').dataset.applicationId)}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ status: button.dataset.applicationDecision, reason }) }); await load(); }
    catch (error) { setMessage(document.querySelector('#property-feedback'), error.message, 'error'); }
  });
  document.querySelector('#welcome-user').textContent = `Signed in as ${user.first_name} ${user.last_name}`;
  await load();
}

async function loadAdmin() {
  const session = await requireRole('administrator'); if (!session) return;
  const { token, user } = session;
  let before = null;
  const load = async () => {
    const [verification, properties] = await Promise.all([
      apiRequest('/api/v1/verification/review-queue', { headers: authHeaders(token) }),
      apiRequest('/api/v1/properties/moderation/queue', { headers: authHeaders(token) })
    ]);
    document.querySelector('#review-count').textContent = verification.submissions.length;
    document.querySelector('#review-list').innerHTML = verification.submissions.length ? verification.submissions.map((item) => `<article class="rounded-lg border border-stone-200 p-4"><h3 class="font-semibold">${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.email)} · ${escapeHtml(item.evidence_reference)}</p><p class="mt-1 text-xs text-green-800">Simulated manual review only</p><div class="mt-3 flex flex-wrap gap-2"><input class="decision-reason field max-w-sm rounded-md border border-stone-300 p-2 text-sm" aria-label="Review reason (required for rejection or resubmission)" placeholder="Reason for decision"><button class="button-secondary" data-verification-decision="needs_resubmission" data-id="${escapeHtml(item.id)}">Request update</button><button class="button-primary" data-verification-decision="approved" data-id="${escapeHtml(item.id)}">Approve simulation</button></div></article>`).join('') : emptyState('No identity submissions are awaiting review.');
    document.querySelector('#moderation-count').textContent = properties.properties.length;
    document.querySelector('#moderation-list').innerHTML = properties.properties.length ? properties.properties.map((item) => `<article class="rounded-lg border border-stone-200 p-4"><h3 class="font-semibold">${escapeHtml(item.title)}</h3><p class="mt-1 text-sm text-stone-500">${escapeHtml(item.location)} · ${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)} · ${formatPrice(item.monthly_rent_ghs)}/month</p><div class="mt-3 flex flex-wrap gap-2"><input class="decision-reason field max-w-sm rounded-md border border-stone-300 p-2 text-sm" aria-label="Rejection reason" placeholder="Reason if rejecting"><button class="button-secondary" data-moderation="rejected" data-id="${escapeHtml(item.id)}">Reject</button><button class="button-primary" data-moderation="published" data-id="${escapeHtml(item.id)}">Publish</button></div></article>`).join('') : emptyState('No properties are awaiting moderation.');
  };
  const loadAudit = async (append = false) => {
    const query = new URLSearchParams({ limit: '25' }); if (before) query.set('before', before);
    const data = await apiRequest(`/api/v1/admin/audit-events?${query}`, { headers: authHeaders(token) });
    const list = document.querySelector('#audit-list');
    if (!append) list.replaceChildren();
    const markup = data.events.map((event) => `<article class="grid gap-1 border-b border-stone-100 py-3 sm:grid-cols-[1fr_auto]"><div><h3 class="text-sm font-semibold">${escapeHtml(event.action.replaceAll('.', ' '))}</h3><p class="text-xs text-stone-500">${escapeHtml(event.target_type)} · ${escapeHtml(event.target_id)} · Actor ${escapeHtml(event.actor_id)}</p></div><time class="text-xs text-stone-500">${escapeHtml(new Date(event.created_at).toLocaleString())}</time></article>`).join('');
    if (append) list.insertAdjacentHTML('beforeend', markup); else list.innerHTML = markup || emptyState('No audit events recorded yet.');
    before = data.pagination.nextBefore;
    document.querySelector('#load-more-audit').disabled = data.events.length < 25 || !before;
  };
  await load();
  await loadAudit();
  document.querySelector('#load-more-audit').addEventListener('click', () => loadAudit(true).catch((error) => setMessage(document.querySelector('#audit-list'), error.message, 'error')));
  document.querySelector('#review-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-verification-decision]'); if (!button) return;
    const reason = button.parentElement.querySelector('.decision-reason').value.trim();
    try { await apiRequest(`/api/v1/verification/submissions/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ status: button.dataset.verificationDecision, reason }) }); await load(); await loadAudit(); }
    catch (error) { setMessage(button.parentElement.parentElement, error.message, 'error'); }
  });
  document.querySelector('#moderation-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-moderation]'); if (!button) return;
    const reason = button.parentElement.querySelector('.decision-reason').value.trim();
    try { await apiRequest(`/api/v1/properties/${encodeURIComponent(button.dataset.id)}/moderation`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ status: button.dataset.moderation, reason }) }); await load(); await loadAudit(); }
    catch (error) { setMessage(button.parentElement.parentElement, error.message, 'error'); }
  });
  document.querySelector('#welcome-user').textContent = `Signed in as ${user.first_name} ${user.last_name}`;
}

const loaders = { properties: loadProperties, property: loadProperty, auth: loadAuth, tenant: loadTenant, landlord: loadLandlord, admin: loadAdmin };
if (loaders[page]) loaders[page]().catch((error) => {
  const main = document.querySelector('main');
  const alert = document.createElement('p'); alert.className = 'mx-auto mt-5 max-w-7xl px-5 text-sm text-red-800'; alert.setAttribute('role', 'alert'); alert.textContent = error.message;
  main.prepend(alert);
});
