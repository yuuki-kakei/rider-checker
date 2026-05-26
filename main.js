(function () {
  'use strict';

  // ====================
  // 設定値
  // ====================
    // 特約まる見えチェッカー経由のLINE登録（UTAGE計測URL・mtid=PzAXRK4JUoY2）
  const LINE_CTA_URL = 'https://go.taspla.co.jp/line/open/Pzdg6zWtlWoP?mtid=PzAXRK4JUoY2';
  // ====================
  // 状態
  // ====================
  let master = null;
  let selectedPolicies = new Set();
  let riderChoices = {};  // { riderId: 'yes' | 'unknown' | 'no' }

  // ====================
  // 起動
  // ====================
  fetch('rider_master.json')
    .then(r => r.json())
    .then(data => {
      master = data;
      renderPolicyList();
      bindNav();
    })
    .catch(err => {
      console.error('master load failed', err);
      document.getElementById('policy-list').innerHTML =
        '<p style="color:#c33">データの読み込みに失敗しました。ページを再読み込みしてください。</p>';
    });

  // ====================
  // Step 1: 保険選択
  // ====================
  function renderPolicyList() {
    const root = document.getElementById('policy-list');
    root.innerHTML = '';
    master.policies.forEach(p => {
      const item = document.createElement('div');
      item.className = 'policy-item';
      item.innerHTML = `
        <input type="checkbox" id="policy-${p.id}" value="${p.id}">
        <label for="policy-${p.id}">${p.label}</label>
      `;
      const cb = item.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedPolicies.add(p.id);
          item.classList.add('checked');
        } else {
          selectedPolicies.delete(p.id);
          item.classList.remove('checked');
        }
        document.getElementById('to-step2').disabled = selectedPolicies.size === 0;
      });
      item.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
      root.appendChild(item);
    });
  }

  // ====================
  // Step 2: 特約チェック
  // ====================
  function renderRiderForm() {
    const root = document.getElementById('rider-form');
    root.innerHTML = '';
    const selectedPolicyIds = Array.from(selectedPolicies);

    selectedPolicyIds.forEach(pid => {
      const policy = master.policies.find(p => p.id === pid);
      const block = document.createElement('div');
      block.className = 'rider-policy';
      block.innerHTML = `<h3>${policy.label}</h3>`;

      policy.riders.forEach(riderId => {
        const rider = master.riders.find(r => r.id === riderId);
        if (!rider) return;
        const item = document.createElement('div');
        item.className = 'rider-item';
        const currentChoice = riderChoices[riderId] || '';
        item.innerHTML = `
          <div class="rider-label">${rider.label}</div>
          <div class="rider-choices" data-rider="${riderId}">
            <div class="rider-choice ${currentChoice === 'yes' ? 'selected-yes' : ''}" data-choice="yes">付いている</div>
            <div class="rider-choice ${currentChoice === 'unknown' ? 'selected-unknown' : ''}" data-choice="unknown">不明</div>
            <div class="rider-choice ${currentChoice === 'no' ? 'selected-no' : ''}" data-choice="no">付いていない</div>
          </div>
        `;
        block.appendChild(item);
      });

      root.appendChild(block);
    });

    // 選択イベント委譲
    root.querySelectorAll('.rider-choices').forEach(group => {
      group.addEventListener('click', e => {
        const choice = e.target.closest('.rider-choice');
        if (!choice) return;
        const riderId = group.getAttribute('data-rider');
        const val = choice.getAttribute('data-choice');
        riderChoices[riderId] = val;
        // 表示更新
        group.querySelectorAll('.rider-choice').forEach(c => {
          c.classList.remove('selected-yes', 'selected-unknown', 'selected-no');
        });
        choice.classList.add('selected-' + val);
      });
    });
  }

  // ====================
  // Step 3: 結果計算・表示
  // ====================
  function calculateResult() {
    // groupId別に「付いている」と回答された特約をまとめる
    const groupYes = {};  // { groupId: [riderObj, ...] }
    Object.keys(riderChoices).forEach(riderId => {
      if (riderChoices[riderId] !== 'yes') return;
      const rider = master.riders.find(r => r.id === riderId);
      if (!rider || !rider.groupId) return;
      if (!groupYes[rider.groupId]) groupYes[rider.groupId] = [];
      groupYes[rider.groupId].push(rider);
    });

    // 2件以上「付いている」のグループ=重複候補
    const duplicates = [];
    let saveMin = 0, saveMax = 0;
    Object.keys(groupYes).forEach(gid => {
      const list = groupYes[gid];
      if (list.length < 2) return;
      // 削減候補=最も安いものを残し、残りを削れる想定
      const sorted = [...list].sort((a, b) => (a.monthlyCostMin + a.monthlyCostMax) - (b.monthlyCostMin + b.monthlyCostMax));
      const removable = sorted.slice(1);
      let gMin = 0, gMax = 0;
      removable.forEach(r => { gMin += r.monthlyCostMin; gMax += r.monthlyCostMax; });
      saveMin += gMin;
      saveMax += gMax;
      const group = master.groups.find(g => g.id === gid);
      duplicates.push({
        group: group,
        riders: list,
        saveMin: gMin,
        saveMax: gMax
      });
    });

    // 見直し候補=groupIdなし or 重複対象外で「付いている」と回答されたもの
    const reviewList = [];
    Object.keys(riderChoices).forEach(riderId => {
      if (riderChoices[riderId] !== 'yes') return;
      const rider = master.riders.find(r => r.id === riderId);
      if (!rider) return;
      // 重複検出グループに含まれているものは除外
      if (rider.groupId && groupYes[rider.groupId] && groupYes[rider.groupId].length >= 2) return;
      reviewList.push(rider);
    });

    return { duplicates, saveMin, saveMax, reviewList };
  }

  function renderResult() {
    const result = calculateResult();

    // 削減目安サマリー
    const summary = document.getElementById('savings-summary');
    if (result.saveMax > 0) {
      const yearMin = result.saveMin * 12;
      const yearMax = result.saveMax * 12;
      summary.innerHTML = `
        <div class="savings-label">重複している特約を見直すと</div>
        <div class="savings-amount">月 <span class="num">${result.saveMin.toLocaleString()}〜${result.saveMax.toLocaleString()}</span> 円</div>
        <div class="savings-yearly">年間で約 ${yearMin.toLocaleString()}〜${yearMax.toLocaleString()} 円の見直し余地</div>
      `;
    } else {
      summary.innerHTML = `
        <div class="savings-none">明確な重複特約は検出されませんでした。<br>引き続き、特約ごとの必要性を確認してみましょう。</div>
      `;
    }

    // 重複リスト
    const dupRoot = document.getElementById('duplicate-list');
    dupRoot.innerHTML = '';
    if (result.duplicates.length > 0) {
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = '重複している可能性のある特約';
      dupRoot.appendChild(title);

      result.duplicates.forEach(d => {
        const card = document.createElement('div');
        card.className = 'duplicate-card';
        const policyLabels = d.riders.map(r => {
          const policy = master.policies.find(p => p.riders.includes(r.id));
          return policy ? policy.label : '';
        }).filter(Boolean);
        card.innerHTML = `
          <h3>${d.group.label}</h3>
          <div class="where">${policyLabels.join(' ／ ')} に重複付帯</div>
          <div class="save-range">月 ${d.saveMin.toLocaleString()}〜${d.saveMax.toLocaleString()} 円が見直し候補</div>
          <div class="explain">${d.group.explanation}</div>
        `;
        dupRoot.appendChild(card);
      });
    }

    // 見直し候補リスト
    const revRoot = document.getElementById('review-list');
    revRoot.innerHTML = '';
    if (result.reviewList.length > 0) {
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = '加入中の特約（相場月額）';
      revRoot.appendChild(title);

      result.reviewList.forEach(r => {
        const card = document.createElement('div');
        card.className = 'review-card';
        const cost = r.monthlyCostMax === 0
          ? '基本付帯（無料）'
          : `月${r.monthlyCostMin.toLocaleString()}〜${r.monthlyCostMax.toLocaleString()}円`;
        card.innerHTML = `
          <div class="name">${r.label}</div>
          <div class="cost">${cost}</div>
        `;
        revRoot.appendChild(card);
      });
    }

    // CTA
    document.getElementById('line-cta').href = LINE_CTA_URL;
  }

  // ====================
  // ステップ遷移
  // ====================
  function bindNav() {
    document.getElementById('to-step2').addEventListener('click', () => {
      renderRiderForm();
      showStep('step2');
    });
    document.getElementById('back-step1').addEventListener('click', () => showStep('step1'));
    document.getElementById('to-step3').addEventListener('click', () => {
      renderResult();
      showStep('step3');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('back-step2').addEventListener('click', () => showStep('step2'));
    document.getElementById('restart').addEventListener('click', () => {
      selectedPolicies.clear();
      riderChoices = {};
      renderPolicyList();
      document.getElementById('to-step2').disabled = true;
      showStep('step1');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function showStep(id) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
})();
