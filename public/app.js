/* Google 广告投放网站分析平台 - 前端逻辑 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { q: '', category: '', adsense: false, hasAds: false, sort: 'recent', page: 1, pageSize: 20 };

  const fmtTime = (ts) => {
    if (!ts) return '–';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 统计 ----------
  async function loadStats() {
    try {
      const s = await (await fetch('/api/stats')).json();
      $('st-total').textContent = s.total.toLocaleString();
      $('st-crawled').textContent = s.crawled.toLocaleString();
      $('st-advertisers').textContent = s.advertisers.toLocaleString();
      $('st-adsense').textContent = s.adsense.toLocaleString();
      const pct = Math.min(100, (s.total / s.target) * 100);
      $('st-progress').style.width = pct.toFixed(1) + '%';
      $('st-target').textContent = `目标 ${s.target.toLocaleString()} 个 · 已完成 ${pct.toFixed(1)}%`;
      renderChips(s.byCategory);
    } catch {
      $('st-total').textContent = '加载失败';
    }
  }

  function renderChips(byCategory) {
    const chips = $('chips');
    const total = byCategory.reduce((a, b) => a + b.count, 0);
    const all = [{ category: '', label: '全部', count: total }, ...byCategory.filter((c) => c.count > 0)];
    chips.innerHTML = all
      .map(
        (c) =>
          `<span class="chip ${state.category === c.category ? 'active' : ''}" data-cat="${c.category}">${esc(c.label)}<span class="cnt">${c.count.toLocaleString()}</span></span>`
      )
      .join('');
    chips.querySelectorAll('.chip').forEach((el) => {
      el.onclick = () => {
        state.category = el.dataset.cat;
        state.page = 1;
        renderChips(byCategory);
        loadList();
      };
    });
  }

  // ---------- 列表 ----------
  async function loadList() {
    const tbody = $('tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">加载中…</td></tr>';
    const p = new URLSearchParams({
      page: state.page, pageSize: state.pageSize, sort: state.sort,
    });
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.adsense) p.set('adsense', '1');
    if (state.hasAds) p.set('hasAds', '1');
    try {
      const data = await (await fetch('/api/sites?' + p.toString())).json();
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无数据，采集器持续运行中，稍后再来看 👀</td></tr>';
        $('pager').innerHTML = '';
        return;
      }
      tbody.innerHTML = data.items
        .map(
          (it) => `<tr class="row" data-domain="${esc(it.domain)}">
            <td>
              <div class="dom">${esc(it.domain)}</div>
              <div class="dom-title">${esc(it.title || '')}</div>
              ${it.summary ? '' : (it.description ? `<div class="dom-desc">${esc(it.description)}</div>` : '')}
            </td>
            <td><span class="badge" style="background:#1b2946;border:1px solid #2a3c63;">${esc(it.categoryLabel || '待分类')}</span></td>
            <td style="max-width:360px;"><div class="dom-desc">${esc(it.summary || '分析生成中…')}</div></td>
            <td>
              <div class="${it.adsense ? 'adsense-yes' : 'adsense-no'}">${it.adsense ? '✓ AdSense' : '—'}</div>
              ${it.adCount ? `<div class="adcnt">${Number(it.adCount).toLocaleString()} 条广告</div>` : ''}
            </td>
            <td>${it.rank ? '#' + it.rank.toLocaleString() : '–'}</td>
            <td style="white-space:nowrap;color:var(--muted);">${fmtTime(it.firstSeen)}</td>
          </tr>`
        )
        .join('');
      tbody.querySelectorAll('tr.row').forEach((tr) => {
        tr.onclick = () => openDetail(tr.dataset.domain);
      });
      renderPager(data.total, data.page, data.pageSize);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">加载失败：' + esc(String(e)) + '</td></tr>';
    }
  }

  function renderPager(total, page, pageSize) {
    const pages = Math.ceil(total / pageSize);
    const pager = $('pager');
    if (pages <= 1) {
      pager.innerHTML = total ? `<span class="info">共 ${total.toLocaleString()} 条</span>` : '';
      return;
    }
    pager.innerHTML = `
      <button id="pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ 上一页</button>
      <span class="info">第 ${page} / ${pages} 页 · 共 ${total.toLocaleString()} 条</span>
      <button id="pg-next" ${page >= pages ? 'disabled' : ''}>下一页 ›</button>`;
    $('pg-prev').onclick = () => { state.page--; loadList(); window.scrollTo({ top: 300, behavior: 'smooth' }); };
    $('pg-next').onclick = () => { state.page++; loadList(); window.scrollTo({ top: 300, behavior: 'smooth' }); };
  }

  // ---------- 详情 ----------
  async function openDetail(domain) {
    const mask = $('drawerMask'), drawer = $('drawer'), body = $('drawerBody');
    mask.classList.add('open');
    drawer.classList.add('open');
    body.innerHTML = '<div class="loading" style="padding:60px 0;text-align:center;color:var(--muted);">加载中…</div>';
    let d;
    try {
      d = await (await fetch('/api/sites/' + encodeURIComponent(domain))).json();
    } catch (e) {
      body.innerHTML = '<p style="color:var(--red);">加载失败 ' + esc(String(e)) + '</p>';
      return;
    }
    if (d.error) {
      body.innerHTML = '<p style="color:var(--red);">' + esc(d.error) + '</p>';
      return;
    }
    try {
      renderDetail(body, d);
    } catch (e) {
      body.innerHTML = '<p style="color:var(--red);">渲染失败: ' + esc(String(e && e.stack ? e.stack : e)) + '</p>';
    }
  }

  function renderDetail(body, d) {
    const data = d.data || {};
    const rdap = data.rdap || {};
    const wayback = data.wayback || {};
    const crux = data.crux || {};
    const ai = d.ai || {};
    const fmtTs = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '–');

    body.innerHTML = `
      <h2>${esc(d.domain)}</h2>
      <div class="d-sub">
        分类：${esc(d.categoryLabel || '待分类')}
        ${d.title ? ' · ' + esc(d.title) : ''}
        <br>
        <a class="ext-link" href="http://${esc(d.domain)}" target="_blank" rel="noopener">打开网站 ↗</a>
        · <a class="ext-link" href="${esc(d.transparencyUrl)}" target="_blank" rel="noopener">透明度中心查看 ↗</a>
      </div>

      <div class="d-section">
        <h3>🤖 AI 分析</h3>
        <div class="d-card">
          ${ai.summary
            ? `<b>这个网站是做什么的：</b>${esc(ai.summary)}`
            : '<span style="color:var(--muted);">AI 分析生成中，刷新后可见（受每日额度限制）。</span>'}
          ${ai.features && ai.features.length ? `<div style="margin-top:8px;"><b>主要功能：</b><div class="tags">${ai.features.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div></div>` : ''}
          ${ai.keywords && ai.keywords.length ? `<div style="margin-top:8px;"><b>关键词：</b><div class="tags">${ai.keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div></div>` : ''}
        </div>
      </div>

      <div class="d-section">
        <h3>📈 网站数据</h3>
        <div class="d-card">
          <div class="kv"><span class="k">全球排名</span><span class="v">${data.rank ? '#' + Number(data.rank).toLocaleString() + '（Cloudflare Radar）' : '暂无（需 RADAR_TOKEN）'}</span></div>
          <div class="kv"><span class="k">域名注册</span><span class="v">${esc(rdap.registered || '–')}${rdap.registrar ? ' · ' + esc(rdap.registrar) : ''}</span></div>
          <div class="kv"><span class="k">最早快照</span><span class="v">${wayback.year ? wayback.year + ' 年（Wayback Machine）' : '–'}</span></div>
          ${crux.lcp ? `<div class="kv"><span class="k">加载体验</span><span class="v">LCP ${esc(crux.lcp.p75)}ms · INP ${esc((crux.inp || {}).p75)}ms · CLS ${esc((crux.cls || {}).p75)}（Google 真实用户）</span></div>` : ''}
          <div class="kv"><span class="k">抓取状态</span><span class="v">HTTP ${esc(d.httpStatus ?? '–')} · ${d.adsense ? '<span class="adsense-yes">检测到 AdSense 代码 ' + esc(d.adClient || '') + '</span>' : '未检测到 AdSense'}</span></div>
          <div class="kv"><span class="k">发现时间</span><span class="v">${fmtTime(d.firstSeen)} · 最近抓取 ${fmtTime(d.lastCrawled)}</span></div>
        </div>
      </div>

      <div class="d-section">
        <h3>📢 广告记录（透明度中心）</h3>
        <div class="d-card">
          ${d.adCount ? `<div class="kv"><span class="k">广告总数</span><span class="v adcnt">${Number(d.adCount).toLocaleString()} 条</span></div>` : ''}
          ${d.creatives && d.creatives.length
            ? d.creatives
                .map(
                  (c) => `<div class="ad-item">
                    <div>${esc(c.advertiserName || c.advertiserId || '未知广告主')}</div>
                    <div class="ad-meta">创意 ${esc(c.creativeId)} · 最近展示 ${fmtTs(c.lastShown)}</div>
                  </div>`
                )
                .join('')
            : '<span style="color:var(--muted);">暂无广告明细。</span>'}
        </div>
      </div>

      ${d.description ? `<div class="d-section"><h3>📝 站点描述</h3><div class="d-card">${esc(d.description)}</div></div>` : ''}
    `;
  }

  function closeDrawer() {
    $('drawerMask').classList.remove('open');
    $('drawer').classList.remove('open');
  }

  // ---------- 事件绑定 ----------
  let searchTimer = null;
  $('q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = $('q').value.trim();
      state.page = 1;
      loadList();
    }, 350);
  });
  $('sort').addEventListener('change', () => {
    state.sort = $('sort').value;
    state.page = 1;
    loadList();
  });
  $('adsense').addEventListener('change', () => { state.adsense = $('adsense').checked; state.page = 1; loadList(); });
  $('hasAds').addEventListener('change', () => { state.hasAds = $('hasAds').checked; state.page = 1; loadList(); });
  $('exportBtn').addEventListener('click', () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    window.open('/api/export.csv?' + p.toString(), '_blank');
  });
  $('drawerMask').addEventListener('click', closeDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);

  loadStats();
  loadList();
  setInterval(loadStats, 30_000);
})();
