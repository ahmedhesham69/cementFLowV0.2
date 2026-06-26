// Supabase Client and App State
let supabaseClient = null;
let factories = [];
let regions = [];
let products = [];
let transporters = [];
let purchases = [];
let dailyPlans = [];
let trips = [];
let deposits = [];

// Chart instances
let trendChart = null;
let regionChart = null;

// Global import state variables
let importedData = [];
let importMode = '';

// DOM Elements
const dbStatusDot = document.getElementById('dbStatusDot');
const dbStatusText = document.getElementById('dbStatusText');
const sbUrlInput = document.getElementById('sbUrl');
const sbAnonKeyInput = document.getElementById('sbAnonKey');

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSubTabs();
  loadSavedConnection();
  setupEventListeners();
});

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const paneId = tab.getAttribute('data-tab');
      document.getElementById(paneId).classList.add('active');

      if (paneId === 'overviewTab') {
        setTimeout(renderCharts, 150);
      }
    });
  });
}

// Sub Tab Navigation inside logs
function initSubTabs() {
  const subTabs = document.querySelectorAll('.sub-tab-btn');
  const subPanes = document.querySelectorAll('.sub-tab-pane');

  subTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      subTabs.forEach(t => t.classList.remove('active'));
      subPanes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const subPaneId = tab.getAttribute('data-subtab');
      document.getElementById(subPaneId).classList.add('active');
    });
  });
}

// Check local storage for Supabase credentials and initialize
function loadSavedConnection() {
  const savedUrl = localStorage.getItem('sb_url');
  const savedKey = localStorage.getItem('sb_key');

  if (savedUrl && savedKey) {
    sbUrlInput.value = savedUrl;
    sbAnonKeyInput.value = savedKey;
    connectSupabase(savedUrl, savedKey);
  }
}

// Connect to Supabase Client
async function connectSupabase(url, anonKey) {
  try {
    dbStatusDot.className = 'indicator-dot offline';
    dbStatusText.textContent = 'جاري الاتصال...';

    // Initialize client
    supabaseClient = supabase.createClient(url, anonKey);

    // Test connection by fetching factories
    const { data, error } = await supabaseClient.from('factories').select('count', { count: 'exact', head: true });
    
    if (error) throw error;

    // Successfully connected
    dbStatusDot.className = 'indicator-dot online';
    dbStatusText.textContent = 'متصل بقاعدة البيانات';
    
    // Save to LocalStorage
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', anonKey);

    // Load initial data
    await loadAllData();
  } catch (error) {
    console.error('Connection failed:', error);
    dbStatusDot.className = 'indicator-dot offline';
    dbStatusText.textContent = 'فشل الاتصال';
    alert('فشل الاتصال بـ Supabase. يرجى التحقق من بيانات الاتصال والجداول.');
  }
}

// Load all tables from Supabase database
async function loadAllData() {
  if (!supabaseClient) return;

  try {
    // 1. Fetch definitions
    const resFactories = await supabaseClient.from('factories').select('*');
    const resRegions = await supabaseClient.from('regions').select('*');
    const resProducts = await supabaseClient.from('factory_products').select('*');
    const resTransporters = await supabaseClient.from('transporters').select('*');

    factories = resFactories.data || [];
    regions = resRegions.data || [];
    products = resProducts.data || [];
    transporters = resTransporters.data || [];

    // 2. Fetch operations
    const resDeposits = await supabaseClient.from('factory_deposits').select('*').order('deposit_date', { ascending: false });
    const resPurchases = await supabaseClient.from('purchases').select('*').order('purchase_date', { ascending: false });
    const resPlans = await supabaseClient.from('daily_plans').select('*').order('plan_date', { ascending: false });
    const resTrips = await supabaseClient.from('trips').select('*').order('trip_date', { ascending: false });

    deposits = resDeposits.data || [];
    purchases = resPurchases.data || [];
    dailyPlans = resPlans.data || [];
    trips = resTrips.data || [];

    // 3. Populate all dropdown inputs in forms
    populateFormSelects();

    // 4. Update Overview KPIs and Factory Balance Cards
    updateKPIs();
    renderFactoryCards();

    // 5. Render tables logs
    renderTripsTable();
    renderPlansTable();
    renderPurchasesTable();
    renderDepositsTable();

    // 6. Draw Charts
    renderCharts();

  } catch (error) {
    console.error('Error loading database tables:', error);
    alert('حدث خطأ أثناء تحميل الجداول. تأكد من تشغيل ملف سكيما SQL بنجاح.');
  }
}

// Populate dropdown forms select inputs
function populateFormSelects() {
  // Master selects
  fillSelect('defProductFactoryId', factories, 'id', 'name');
  fillSelect('txDepositFactoryId', factories, 'id', 'name');
  fillSelect('txPurchaseRegionId', regions, 'id', 'name');
  fillSelect('txPlanRegionId', regions, 'id', 'name');
  fillSelect('txTripRegionId', regions, 'id', 'name');
  fillSelect('txTripTransporterId', transporters, 'id', 'name');

  // Products selects (with factory name prefix for clarity)
  const productOptions = products.map(p => {
    const fact = factories.find(f => f.id === p.factory_id);
    return {
      id: p.id,
      name: `${fact ? fact.name : 'مصنع مجهول'} - ${p.name}`
    };
  });
  fillSelect('txPurchaseProductId', productOptions, 'id', 'name');
  fillSelect('txPlanProductId', productOptions, 'id', 'name');

  // Purchase select options for Trips form
  const purchaseOptions = purchases.map(p => {
    const prod = products.find(pr => pr.id === p.product_id);
    const fact = prod ? factories.find(f => f.id === prod.factory_id) : null;
    const reg = regions.find(r => r.id === p.region_id);
    return {
      id: p.id,
      name: `${fact ? fact.name : ''} (${prod ? prod.name : ''}) | منطقة: ${reg ? reg.name : ''} | كمية: ${p.quantity_tons} طن`
    };
  });
  fillSelect('txTripPurchaseId', purchaseOptions, 'id', 'name', true);

  // Daily plans options for Trips form
  const planOptions = dailyPlans.map(p => {
    const prod = products.find(pr => pr.id === p.product_id);
    const reg = regions.find(r => r.id === p.region_id);
    return {
      id: p.id,
      name: `${p.plan_date} | ${prod ? prod.name : ''} -> ${reg ? reg.name : ''}`
    };
  });
  fillSelect('txTripPlanId', planOptions, 'id', 'name', true);
}

function fillSelect(elementId, dataset, valueKey, labelKey, optional = false) {
  const select = document.getElementById(elementId);
  if (!select) return;

  select.innerHTML = optional ? `<option value="">-- اختياري --</option>` : `<option value="">اختر من القائمة...</option>`;

  dataset.forEach(item => {
    const option = document.createElement('option');
    option.value = item[valueKey];
    option.textContent = item[labelKey];
    select.appendChild(option);
  });
}

// Calculate Financials & Update KPI metrics
function updateKPIs() {
  // 1. Total deposits
  const totalDeposits = deposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);

  // 2. Net Loaded Cost
  // Cost = loaded_weight_tons * (unit_purchase_price OR purchase.price_per_ton)
  let netLoadedCost = 0;
  trips.forEach(t => {
    let pricePerTon = 0;
    if (t.unit_purchase_price && parseFloat(t.unit_purchase_price) > 0) {
      pricePerTon = parseFloat(t.unit_purchase_price);
    } else if (t.purchase_id) {
      const matchPurch = purchases.find(p => p.id === t.purchase_id);
      if (matchPurch) pricePerTon = parseFloat(matchPurch.price_per_ton);
    }
    netLoadedCost += parseFloat(t.loaded_weight_tons) * pricePerTon;
  });

  const availableBalance = totalDeposits - netLoadedCost;

  // 3. Total planned & loaded quantities
  const totalPlanned = purchases.reduce((sum, p) => sum + parseFloat(p.quantity_tons), 0);
  const totalLoaded = trips.reduce((sum, t) => sum + parseFloat(t.loaded_weight_tons), 0);
  const totalDeficit = trips.reduce((sum, t) => {
    const planned = t.planned_weight_tons ? parseFloat(t.planned_weight_tons) : parseFloat(t.loaded_weight_tons);
    const deficit = Math.max(planned - parseFloat(t.loaded_weight_tons), 0);
    return sum + deficit;
  }, 0);

  // Render on UI
  document.getElementById('kpiBalance').innerHTML = `${availableBalance.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span class="currency">ج.م</span>`;
  document.getElementById('kpiPlanned').innerHTML = `${totalPlanned.toLocaleString('ar-EG')} <span class="currency">طن</span>`;
  document.getElementById('kpiLoaded').innerHTML = `${totalLoaded.toLocaleString('ar-EG')} <span class="currency">طن</span>`;
  document.getElementById('kpiDeficit').innerHTML = `${totalDeficit.toLocaleString('ar-EG')} <span class="currency">طن</span>`;

  const progress = totalPlanned > 0 ? Math.round((totalLoaded / totalPlanned) * 100) : 0;
  document.getElementById('kpiProgressPct').textContent = `نسبة إنجاز التحميل: ${progress}%`;
  document.getElementById('kpiProgressFill').style.width = `${Math.min(progress, 100)}%`;
}

// Render Apple-style Factory Cards
function renderFactoryCards() {
  const container = document.getElementById('factoryCardsContainer');
  container.innerHTML = '';

  if (factories.length === 0) {
    container.innerHTML = '<div class="no-data-msg">لا يوجد مصانع مضافة بقاعدة البيانات بعد.</div>';
    return;
  }

  factories.forEach(f => {
    // Gather products under this factory
    const factoryProds = products.filter(p => p.factory_id === f.id);
    
    // Calculate factory metrics
    const fDeposits = deposits.filter(d => d.factory_id === f.id).reduce((sum, d) => sum + parseFloat(d.amount), 0);
    
    let fLoadedCost = 0;
    let fTripsCount = 0;
    
    const productStats = factoryProds.map(prod => {
      // Find purchases of this product
      const prodPurchases = purchases.filter(p => p.product_id === prod.id);
      const plannedTons = prodPurchases.reduce((sum, p) => sum + parseFloat(p.quantity_tons), 0);

      // Find trips loaded of this product
      // We know a trip's product by linking trip -> purchase (or daily plan) -> product
      const prodTrips = trips.filter(t => {
        if (t.purchase_id) {
          const purch = purchases.find(p => p.id === t.purchase_id);
          return purch && purch.product_id === prod.id;
        }
        if (t.daily_plan_id) {
          const plan = dailyPlans.find(pl => pl.id === t.daily_plan_id);
          return plan && plan.product_id === prod.id;
        }
        return false;
      });

      fTripsCount += prodTrips.length;

      const loadedTons = prodTrips.reduce((sum, t) => sum + parseFloat(t.loaded_weight_tons), 0);
      const deficitTons = prodTrips.reduce((sum, t) => {
        const planned = t.planned_weight_tons ? parseFloat(t.planned_weight_tons) : parseFloat(t.loaded_weight_tons);
        return sum + Math.max(planned - parseFloat(t.loaded_weight_tons), 0);
      }, 0);

      // Calculate loaded cost for this product
      prodTrips.forEach(t => {
        let price = 0;
        if (t.unit_purchase_price && parseFloat(t.unit_purchase_price) > 0) {
          price = parseFloat(t.unit_purchase_price);
        } else if (t.purchase_id) {
          const purch = purchases.find(p => p.id === t.purchase_id);
          if (purch) price = parseFloat(purch.price_per_ton);
        }
        fLoadedCost += parseFloat(t.loaded_weight_tons) * price;
      });

      return {
        name: prod.name,
        planned: plannedTons,
        loaded: loadedTons,
        deficit: deficitTons
      };
    });

    const netFactoryBalance = fDeposits - fLoadedCost;

    // Render Card
    const card = document.createElement('div');
    card.className = 'factory-card';

    let prodsHTML = '';
    productStats.forEach(p => {
      const pct = p.planned > 0 ? Math.round((p.loaded / p.planned) * 100) : 0;
      prodsHTML += `
        <div class="card-product-item">
          <div class="prod-meta">
            <span>${p.name}</span>
            <span style="color: var(--color-blue)">${pct}%</span>
          </div>
          <div class="apple-progress-bar">
            <div class="progress-fill" style="width: ${Math.min(pct, 100)}%"></div>
          </div>
          <div class="prod-nums">
            <div class="prod-num-box">
              <span class="lbl">مخطط</span>
              <span class="val">${p.planned.toLocaleString('ar-EG')} طن</span>
            </div>
            <div class="prod-num-box">
              <span class="lbl">محمل</span>
              <span class="val" style="color: var(--color-green)">${p.loaded.toLocaleString('ar-EG')} طن</span>
            </div>
            <div class="prod-num-box">
              <span class="lbl">عجز</span>
              <span class="val" style="color: var(--color-red)">${p.deficit.toLocaleString('ar-EG')} طن</span>
            </div>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="card-header-row">
        <span class="card-title-badge">${f.name}</span>
        <span class="card-detail-text">رصيد الحساب الجاري:</span>
      </div>
      
      <div class="kpi-value" style="font-size: 22px; margin-top: -8px;">
        ${netFactoryBalance.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span class="currency" style="font-size: 11px">ج.م</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-sub)">المنتجات وحالة الشحن:</span>
        ${prodsHTML || '<span style="font-size: 12px; color: var(--text-sub)">لا توجد منتجات مضافة لهذا المصنع</span>'}
      </div>
      
      <div class="card-detail-text" style="margin-top: auto; border-top: 1px solid var(--border-card); padding-top: 12px; display: flex; justify-content: space-between;">
        <span>إجمالي الإيداعات: ${fDeposits.toLocaleString('ar-EG')} ج.م</span>
        <span>الرحلات: ${fTripsCount}</span>
      </div>
    `;

    container.appendChild(card);
  });
}

// Render data logs tables (Trips, Plans, Purchases, Deposits)
function renderTripsTable() {
  const body = document.getElementById('tblTripsBody');
  const search = document.getElementById('searchTrips').value.toLowerCase();
  body.innerHTML = '';

  const displayList = trips.filter(t => {
    const matchSearch = !search || 
      (t.driver_name && t.driver_name.toLowerCase().includes(search)) ||
      (t.vehicle_plate && t.vehicle_plate.toLowerCase().includes(search)) ||
      (t.loading_permission_number && t.loading_permission_number.toLowerCase().includes(search));
    return matchSearch;
  });

  if (displayList.length === 0) {
    body.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-sub)">لا توجد رحلات مسجلة.</td></tr>`;
    return;
  }

  displayList.forEach(t => {
    const reg = regions.find(r => r.id === t.region_id);
    const trans = transporters.find(tr => tr.id === t.transporter_id);
    
    // Find Product via Purchase Order
    let prodName = 'غير محدد';
    let factName = 'غير محدد';
    if (t.purchase_id) {
      const purch = purchases.find(p => p.id === t.purchase_id);
      if (purch) {
        const prod = products.find(pr => pr.id === purch.product_id);
        if (prod) {
          prodName = prod.name;
          const fact = factories.find(f => f.id === prod.factory_id);
          factName = fact ? fact.name : 'غير محدد';
        }
      }
    }

    const planned = t.planned_weight_tons ? parseFloat(t.planned_weight_tons) : parseFloat(t.loaded_weight_tons);
    const deficit = Math.max(planned - parseFloat(t.loaded_weight_tons), 0);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${t.trip_date}</td>
      <td><code>${t.loading_permission_number || '-'}</code></td>
      <td><code>${t.waybill_number || '-'}</code></td>
      <td>${factName}</td>
      <td><strong>${prodName}</strong></td>
      <td>${reg ? reg.name : '-'}</td>
      <td>${planned} طن</td>
      <td style="color: var(--color-green); font-weight: 700;">${t.loaded_weight_tons} طن</td>
      <td style="color: ${deficit > 0 ? 'var(--color-red)' : 'var(--text-sub)'}; font-weight: 700;">
        ${deficit > 0 ? deficit + ' طن' : '-'}
      </td>
      <td>${trans ? trans.name : '-'}</td>
      <td>${t.driver_name || '-'}<br><span style="font-size: 10px; color: var(--text-sub)">سيارة: ${t.vehicle_plate || '-'} | مقطورة: ${t.trailer_plate || '-'}</span></td>
    `;
    body.appendChild(row);
  });
}

function renderPlansTable() {
  const body = document.getElementById('tblPlansBody');
  const search = document.getElementById('searchPlans').value.toLowerCase();
  body.innerHTML = '';

  const displayList = dailyPlans.filter(dp => {
    const reg = regions.find(r => r.id === dp.region_id);
    const prod = products.find(p => p.id === dp.product_id);
    const matchSearch = !search ||
      (reg && reg.name.toLowerCase().includes(search)) ||
      (prod && prod.name.toLowerCase().includes(search));
    return matchSearch;
  });

  if (displayList.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-sub)">لا توجد خطط تحميل مسجلة.</td></tr>`;
    return;
  }

  displayList.forEach(dp => {
    const prod = products.find(p => p.id === dp.product_id);
    const fact = prod ? factories.find(f => f.id === prod.factory_id) : null;
    const reg = regions.find(r => r.id === dp.region_id);

    const statusText = dp.status === 'completed' ? 'مكتمل' : (dp.status === 'active' ? 'نشط' : 'ملغي');
    const statusClass = dp.status === 'completed' ? 'completed' : (dp.status === 'active' ? 'active' : 'cancelled');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${dp.plan_date}</td>
      <td>${fact ? fact.name : '-'}</td>
      <td><strong>${prod ? prod.name : '-'}</strong></td>
      <td>${reg ? reg.name : '-'}</td>
      <td>${dp.planned_trips}</td>
      <td>${dp.planned_weight_per_trip} طن</td>
      <td><span class="badge-status ${statusClass}">${statusText}</span></td>
    `;
    body.appendChild(row);
  });
}

function renderPurchasesTable() {
  const body = document.getElementById('tblPurchasesBody');
  const search = document.getElementById('searchPurchases').value.toLowerCase();
  body.innerHTML = '';

  const displayList = purchases.filter(p => {
    const prod = products.find(pr => pr.id === p.product_id);
    const reg = regions.find(r => r.id === p.region_id);
    const matchSearch = !search ||
      (prod && prod.name.toLowerCase().includes(search)) ||
      (reg && reg.name.toLowerCase().includes(search));
    return matchSearch;
  });

  if (displayList.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-sub)">لا توجد أوامر شراء مسجلة.</td></tr>`;
    return;
  }

  displayList.forEach(p => {
    const prod = products.find(pr => pr.id === p.product_id);
    const fact = prod ? factories.find(f => f.id === prod.factory_id) : null;
    const reg = regions.find(r => r.id === p.region_id);
    const totalCost = parseFloat(p.quantity_tons) * parseFloat(p.price_per_ton);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${p.purchase_date}</td>
      <td>${fact ? fact.name : '-'}</td>
      <td><strong>${prod ? prod.name : '-'}</strong></td>
      <td>${reg ? reg.name : '-'}</td>
      <td>${p.quantity_tons} طن</td>
      <td>${parseFloat(p.price_per_ton).toLocaleString()} ج.م</td>
      <td style="font-weight: 700;">${totalCost.toLocaleString()} ج.م</td>
    `;
    body.appendChild(row);
  });
}

function renderDepositsTable() {
  const body = document.getElementById('tblDepositsBody');
  const search = document.getElementById('searchDeposits').value.toLowerCase();
  body.innerHTML = '';

  const displayList = deposits.filter(d => {
    const fact = factories.find(f => f.id === d.factory_id);
    const matchSearch = !search ||
      (fact && fact.name.toLowerCase().includes(search)) ||
      (d.reference_no && d.reference_no.toLowerCase().includes(search));
    return matchSearch;
  });

  if (displayList.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-sub)">لا توجد إيداعات مسجلة.</td></tr>`;
    return;
  }

  displayList.forEach(d => {
    const fact = factories.find(f => f.id === d.factory_id);
    let payMethod = 'حوالة بنكية';
    if (d.payment_method === 'cash') payMethod = 'نقدي';
    if (d.payment_method === 'cheque') payMethod = 'شيك';
    if (d.payment_method === 'other') payMethod = 'أخرى';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${d.deposit_date}</td>
      <td>${fact ? fact.name : '-'}</td>
      <td><span class="badge-status active">${payMethod}</span></td>
      <td><code>${d.reference_no || '-'}</code></td>
      <td style="font-weight: 700; color: var(--color-blue);">${parseFloat(d.amount).toLocaleString()} ج.م</td>
      <td>${d.notes || '-'}</td>
    `;
    body.appendChild(row);
  });
}

// Render Charts
function renderCharts() {
  const trendCanvas = document.getElementById('overviewTrendChart');
  const regionCanvas = document.getElementById('overviewRegionChart');
  if (!trendCanvas || !regionCanvas) return;

  // 1. Trend calculations
  const trendData = {};
  purchases.forEach(p => {
    if (!trendData[p.purchase_date]) trendData[p.purchase_date] = { planned: 0, loaded: 0 };
    trendData[p.purchase_date].planned += parseFloat(p.quantity_tons);
  });
  trips.forEach(t => {
    if (!trendData[t.trip_date]) trendData[t.trip_date] = { planned: 0, loaded: 0 };
    trendData[t.trip_date].loaded += parseFloat(t.loaded_weight_tons);
  });

  const sortedDates = Object.keys(trendData).sort().slice(-10); // last 10 dates
  const plansLine = sortedDates.map(d => trendData[d].planned);
  const loadedLine = sortedDates.map(d => trendData[d].loaded);

  // Draw Trend Chart
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(trendCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: sortedDates,
      datasets: [
        {
          label: 'الكمية المخططة (طن)',
          data: plansLine,
          borderColor: '#a29bfe',
          backgroundColor: 'rgba(162, 155, 254, 0.05)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'الكمية الفعلية المحملة (طن)',
          data: loadedLine,
          borderColor: '#0071e3',
          backgroundColor: 'rgba(0, 113, 227, 0.05)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: 'Tajawal' } } } },
      scales: {
        x: { ticks: { font: { family: 'Tajawal' } } },
        y: { ticks: { font: { family: 'Tajawal' } } }
      }
    }
  });

  // 2. Region calculations
  const regionWeights = {};
  trips.forEach(t => {
    const reg = regions.find(r => r.id === t.region_id);
    const regName = reg ? reg.name : 'غير محدد';
    if (!regionWeights[regName]) regionWeights[regName] = 0;
    regionWeights[regName] += parseFloat(t.loaded_weight_tons);
  });

  const sortedRegs = Object.entries(regionWeights).sort((a, b) => b[1] - a[1]);
  const regLabels = sortedRegs.map(r => r[0]);
  const regValues = sortedRegs.map(r => r[1]);

  // Draw Region Chart
  if (regionChart) regionChart.destroy();
  regionChart = new Chart(regionCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: regLabels,
      datasets: [{
        label: 'الحمولة المحملة (طن)',
        data: regValues,
        backgroundColor: '#34c759',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: 'Tajawal' } } } },
      scales: {
        x: { ticks: { font: { family: 'Tajawal' } } },
        y: { ticks: { font: { family: 'Tajawal' } } }
      }
    }
  });
}

// Setup Form Submission Listeners (CRUD writes to Supabase)
function setupEventListeners() {
  
  // Settings Form
  document.getElementById('formConnectionSettings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = sbUrlInput.value.trim();
    const key = sbAnonKeyInput.value.trim();
    await connectSupabase(url, key);
  });

  // Disconnect button
  document.getElementById('btnDisconnect').addEventListener('click', () => {
    localStorage.removeItem('sb_url');
    localStorage.removeItem('sb_key');
    sbUrlInput.value = '';
    sbAnonKeyInput.value = '';
    supabaseClient = null;
    dbStatusDot.className = 'indicator-dot offline';
    dbStatusText.textContent = 'غير متصل';
    
    // Clear data arrays
    factories = []; regions = []; products = []; transporters = [];
    purchases = []; dailyPlans = []; trips = []; deposits = [];

    // Re-render empty UI
    updateKPIs();
    renderFactoryCards();
    renderTripsTable();
    renderPlansTable();
    renderPurchasesTable();
    renderDepositsTable();
    if (trendChart) trendChart.destroy();
    if (regionChart) regionChart.destroy();
  });

  // Master definitions submissions
  setupFormInsert('formAddFactory', 'factories', () => ({
    name: document.getElementById('defFactoryName').value.trim(),
    location: document.getElementById('defFactoryLoc').value.trim()
  }), ['defFactoryName', 'defFactoryLoc']);

  setupFormInsert('formAddRegion', 'regions', () => ({
    name: document.getElementById('defRegionName').value.trim()
  }), ['defRegionName']);

  setupFormInsert('formAddProduct', 'factory_products', () => ({
    factory_id: document.getElementById('defProductFactoryId').value,
    name: document.getElementById('defProductName').value.trim(),
    standard_trip_weight: document.getElementById('defProductWeight').value ? parseFloat(document.getElementById('defProductWeight').value) : null
  }), ['defProductFactoryId', 'defProductName', 'defProductWeight']);

  setupFormInsert('formAddTransporter', 'transporters', () => ({
    name: document.getElementById('defTransporterName').value.trim(),
    phone: document.getElementById('defTransporterPhone').value.trim()
  }), ['defTransporterName', 'defTransporterPhone']);

  // Transaction submissions
  setupFormInsert('formAddDeposit', 'factory_deposits', () => ({
    factory_id: document.getElementById('txDepositFactoryId').value,
    deposit_date: document.getElementById('txDepositDate').value,
    amount: parseFloat(document.getElementById('txDepositAmount').value),
    payment_method: document.getElementById('txDepositMethod').value,
    reference_no: document.getElementById('txDepositRef').value.trim(),
    notes: document.getElementById('txDepositNotes').value.trim()
  }), ['txDepositFactoryId', 'txDepositDate', 'txDepositAmount', 'txDepositMethod', 'txDepositRef', 'txDepositNotes']);

  setupFormInsert('formAddPurchase', 'purchases', () => ({
    product_id: document.getElementById('txPurchaseProductId').value,
    region_id: document.getElementById('txPurchaseRegionId').value,
    purchase_date: document.getElementById('txPurchaseDate').value,
    quantity_tons: parseFloat(document.getElementById('txPurchaseQty').value),
    price_per_ton: parseFloat(document.getElementById('txPurchasePrice').value),
    notes: document.getElementById('txPurchaseNotes').value.trim()
  }), ['txPurchaseProductId', 'txPurchaseRegionId', 'txPurchaseDate', 'txPurchaseQty', 'txPurchasePrice', 'txPurchaseNotes']);

  setupFormInsert('formAddDailyPlan', 'daily_plans', () => ({
    product_id: document.getElementById('txPlanProductId').value,
    region_id: document.getElementById('txPlanRegionId').value,
    plan_date: document.getElementById('txPlanDate').value,
    planned_trips: parseInt(document.getElementById('txPlanTrips').value),
    planned_weight_per_trip: parseFloat(document.getElementById('txPlanWeightPerTrip').value)
  }), ['txPlanProductId', 'txPlanRegionId', 'txPlanDate', 'txPlanTrips', 'txPlanWeightPerTrip']);

  setupFormInsert('formAddTrip', 'trips', () => ({
    purchase_id: document.getElementById('txTripPurchaseId').value || null,
    daily_plan_id: document.getElementById('txTripPlanId').value || null,
    region_id: document.getElementById('txTripRegionId').value,
    transporter_id: document.getElementById('txTripTransporterId').value,
    trip_date: document.getElementById('txTripDate').value,
    planned_weight_tons: parseFloat(document.getElementById('txTripPlannedWeight').value),
    loaded_weight_tons: parseFloat(document.getElementById('txTripLoadedWeight').value),
    unit_purchase_price: document.getElementById('txTripPurchasePrice').value ? parseFloat(document.getElementById('txTripPurchasePrice').value) : null,
    loading_permission_number: document.getElementById('txTripPermissionNo').value.trim(),
    waybill_number: document.getElementById('txTripWaybillNo').value.trim(),
    driver_name: document.getElementById('txTripDriverName').value.trim(),
    driver_phone: document.getElementById('txTripDriverPhone').value.trim(),
    vehicle_plate: document.getElementById('txTripCarPlate').value.trim(),
    trailer_plate: document.getElementById('txTripTrailerPlate').value.trim(),
    notes: document.getElementById('txTripNotes').value.trim()
  }), [
    'txTripPurchaseId', 'txTripPlanId', 'txTripRegionId', 'txTripTransporterId',
    'txTripDate', 'txTripPlannedWeight', 'txTripLoadedWeight', 'txTripPurchasePrice',
    'txTripPermissionNo', 'txTripWaybillNo', 'txTripDriverName', 'txTripDriverPhone',
    'txTripCarPlate', 'txTripTrailerPlate', 'txTripNotes'
  ]);

  // Live search keyup triggers
  document.getElementById('searchTrips').addEventListener('input', renderTripsTable);
  document.getElementById('searchPlans').addEventListener('input', renderPlansTable);
  document.getElementById('searchPurchases').addEventListener('input', renderPurchasesTable);
  document.getElementById('searchDeposits').addEventListener('input', renderDepositsTable);

  // Auto-fill plan weight per trip when product is selected in Daily Plan form
  const txPlanProductIdSelect = document.getElementById('txPlanProductId');
  if (txPlanProductIdSelect) {
    txPlanProductIdSelect.addEventListener('change', (e) => {
      const prodId = e.target.value;
      if (prodId) {
        const prod = products.find(p => p.id === prodId);
        if (prod && prod.standard_trip_weight) {
          document.getElementById('txPlanWeightPerTrip').value = prod.standard_trip_weight;
        }
      }
    });
  }

  // Auto-fill actual trip details when Daily Plan is selected
  const txTripPlanIdSelect = document.getElementById('txTripPlanId');
  if (txTripPlanIdSelect) {
    txTripPlanIdSelect.addEventListener('change', (e) => {
      const planId = e.target.value;
      if (planId) {
        const plan = dailyPlans.find(p => p.id === planId);
        if (plan) {
          document.getElementById('txTripPlannedWeight').value = plan.planned_weight_per_trip;
          const regionSelect = document.getElementById('txTripRegionId');
          if (regionSelect) regionSelect.value = plan.region_id;
        }
      }
    });
  }

  // Auto-fill actual trip details when Purchase Order is selected
  const txTripPurchaseIdSelect = document.getElementById('txTripPurchaseId');
  if (txTripPurchaseIdSelect) {
    txTripPurchaseIdSelect.addEventListener('change', (e) => {
      const purchaseId = e.target.value;
      if (purchaseId) {
        const purchase = purchases.find(p => p.id === purchaseId);
        if (purchase) {
          const regionSelect = document.getElementById('txTripRegionId');
          if (regionSelect) regionSelect.value = purchase.region_id;

          const prod = products.find(p => p.id === purchase.product_id);
          if (prod && prod.standard_trip_weight) {
            document.getElementById('txTripPlannedWeight').value = prod.standard_trip_weight;
          }
        }
      }
    });
  }

  // Auto-import event listeners
  const btnParsePlans = document.getElementById('btnParsePlans');
  const btnParseTrips = document.getElementById('btnParseTrips');
  const btnClearImport = document.getElementById('btnClearImport');
  const btnSaveImported = document.getElementById('btnSaveImported');

  if (btnParsePlans) btnParsePlans.addEventListener('click', handleParsePlans);
  if (btnParseTrips) btnParseTrips.addEventListener('click', handleParseTrips);
  if (btnClearImport) btnClearImport.addEventListener('click', () => {
    document.getElementById('importRawText').value = '';
    document.getElementById('importPreviewSection').style.display = 'none';
    importedData = [];
  });
  if (btnSaveImported) btnSaveImported.addEventListener('click', saveImportedToDatabase);
}

// Generic function to attach form submission insert logic
function setupFormInsert(formId, tableName, getPayloadFn, inputsToClear) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!supabaseClient) {
      alert('الرجاء الاتصال بقاعدة بيانات Supabase أولاً.');
      return;
    }

    try {
      const payload = getPayloadFn();
      
      const { data, error } = await supabaseClient
        .from(tableName)
        .insert([payload])
        .select();

      if (error) throw error;

      alert('تم تسجيل البيانات وحفظها بنجاح!');
      
      // Clear inputs
      inputsToClear.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
          if (input.tagName === 'SELECT') input.selectedIndex = 0;
          else input.value = '';
        }
      });

      // Reload database tables and update UI
      await loadAllData();

    } catch (error) {
      console.error(`Insert failed in ${tableName}:`, error);
      alert(`فشل الحفظ: ${error.message}`);
    }
  });
}

// ============================================================
// TEXT PARSER & AUTO IMPORT LOGIC
// ============================================================

// Arabic date parser helper
function parseArabicDate(dateStr) {
  const match = dateStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  const d = new Date();
  return d.toISOString().split('T')[0];
}

// 1. Parsing Daily Plans from WhatsApp text
function handleParsePlans() {
  const rawText = document.getElementById('importRawText').value.trim();
  if (!rawText) {
    alert('الرجاء لصق رسائل المخطط أولاً.');
    return;
  }

  const blocks = rawText.split(/عميلنا العزيز/i).filter(b => b.trim().length > 0);
  importedData = [];
  importMode = 'plans';

  blocks.forEach(block => {
    const typeMatch = block.match(/النوع:\s*([^\n]+)/);
    const qtyMatch = block.match(/الكمية:\s*([\d.]+)/);
    const dateMatch = block.match(/(?:📅\s*)?التاريخ:\s*([^\n]+)/);
    const regionMatch = block.match(/(?:📍\s*)?موقع التسليم:\s*([^\n]+)/);
    const transporterMatch = block.match(/(?:🚛\s*)?شركة النقل:\s*([^\n]+)/);

    let factoryName = "أسمنت العريش";
    if (block.includes("العريش للأسمنت")) {
      factoryName = "أسمنت العريش";
    }

    if (typeMatch && qtyMatch && dateMatch && regionMatch) {
      const type = typeMatch[1].trim();
      const qty = parseFloat(qtyMatch[1]);
      const rawDate = dateMatch[1].trim();
      const cleanDate = parseArabicDate(rawDate);
      const region = regionMatch[1].trim();
      const transporter = transporterMatch ? transporterMatch[1].trim() : "غير محدد";

      importedData.push({
        factoryName,
        productName: type,
        quantity: qty,
        date: cleanDate,
        rawDate,
        regionName: region,
        transporterName: transporter
      });
    }
  });

  renderImportPreview();
}

// 2. Parsing Actual Trips from WhatsApp text
function handleParseTrips() {
  const rawText = document.getElementById('importRawText').value.trim();
  if (!rawText) {
    alert('الرجاء لصق رسائل الإثبات أولاً.');
    return;
  }

  const blocks = rawText.split(/مرحبًا\s*👋|مرحبا\s*👋/i).filter(b => b.trim().length > 0);
  importedData = [];
  importMode = 'trips';

  blocks.forEach(block => {
    const typeMatch = block.match(/نوع الخامة:\s*([^\n]+)/);
    const saleOrderMatch = block.match(/رقم أمر البيع:\s*([^\n]+)/);
    const weightMatch = block.match(/وزن النقلة الفعلي\s*\(طن\):\s*([\d.]+)/);
    const permMatch = block.match(/رقم إذن التحميل:\s*([^\n]+)/);
    const waybillMatch = block.match(/رقم بوليصة الشحن:\s*([^\n]+)/);
    const transporterMatch = block.match(/اسم شركة النقل🚗?:\s*([^\n]+)/);
    const driverMatch = block.match(/اسم السائق\s*🙎🏼‍♂️?:\s*([^\n—]+)/);
    const driverPhoneMatch = block.match(/رقم السائق:\s*(\d+)/);
    const platesBlock = block.match(/رقم السيارة:\s*([^\n—]+)(?:—\s*رقم المقطورة:\s*([^\n]+))?/);
    const regionMatch = block.match(/موقع التسليم\s*🗺️?:\s*([^\n]+)/);
    const receiverMatch = block.match(/اسم مسؤول الاستلام\s*👨🏼‍💼?:\s*([^\n—]+)/);
    const receiverPhoneMatch = block.match(/رقمه:\s*(\d+)/);
    const dateMatch = block.match(/تاريخ إثبات النقلة\s*📅?:\s*([^\n]+)/);

    let factoryName = "أسمنت العريش";
    if (block.includes("العريش للأسمنت")) {
      factoryName = "أسمنت العريش";
    }

    if (typeMatch && weightMatch && dateMatch && regionMatch) {
      const type = typeMatch[1].trim();
      const weight = parseFloat(weightMatch[1]);
      const rawDate = dateMatch[1].trim();
      const cleanDate = parseArabicDate(rawDate);
      const region = regionMatch[1].trim();

      const saleOrder = saleOrderMatch ? saleOrderMatch[1].trim() : null;
      const permNo = permMatch ? permMatch[1].trim() : null;
      const waybillNo = waybillMatch ? waybillMatch[1].trim() : null;
      const transporter = transporterMatch ? transporterMatch[1].trim() : "غير محدد";
      const driver = driverMatch ? driverMatch[1].trim() : null;
      const driverPhone = driverPhoneMatch ? driverPhoneMatch[1].trim() : null;
      const carPlate = platesBlock ? platesBlock[1].trim() : null;
      const trailerPlate = platesBlock && platesBlock[2] ? platesBlock[2].trim() : null;
      const receiverName = receiverMatch ? receiverMatch[1].trim() : null;
      const receiverPhone = receiverPhoneMatch ? receiverPhoneMatch[1].trim() : null;

      importedData.push({
        factoryName,
        productName: type,
        loadedWeight: weight,
        date: cleanDate,
        rawDate,
        regionName: region,
        saleOrder,
        permNo,
        waybillNo,
        transporterName: transporter,
        driverName: driver,
        driverPhone,
        carPlate,
        trailerPlate,
        receiverName,
        receiverPhone
      });
    }
  });

  renderImportPreview();
}

// 3. Render the preview table
function renderImportPreview() {
  const section = document.getElementById('importPreviewSection');
  const countEl = document.getElementById('importCount');
  const thead = document.getElementById('tblImportPreviewHead');
  const tbody = document.getElementById('tblImportPreviewBody');

  if (importedData.length === 0) {
    alert('لم نتمكن من استخلاص أي بيانات. يرجى التأكد من تطابق النص مع تنسيق الرسائل.');
    section.style.display = 'none';
    return;
  }

  countEl.textContent = importedData.length;
  tbody.innerHTML = '';

  if (importMode === 'plans') {
    thead.innerHTML = `
      <tr>
        <th>المصنع</th>
        <th>المنتج</th>
        <th>الوزن المخطط (طن)</th>
        <th>تاريخ الخطة</th>
        <th>المنطقة</th>
        <th>شركة النقل</th>
      </tr>
    `;

    importedData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.factoryName}</td>
        <td>${row.productName}</td>
        <td>${row.quantity} طن</td>
        <td>${row.date}</td>
        <td>${row.regionName}</td>
        <td>${row.transporterName}</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    thead.innerHTML = `
      <tr>
        <th>التاريخ</th>
        <th>إذن التحميل</th>
        <th>المنتج</th>
        <th>الوزن الفعلي</th>
        <th>المنطقة</th>
        <th>السائق والسيارة</th>
        <th>شركة النقل</th>
      </tr>
    `;

    importedData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.date}</td>
        <td>${row.permNo || 'بدون'}</td>
        <td>${row.productName}</td>
        <td>${row.loadedWeight} طن</td>
        <td>${row.regionName}</td>
        <td>${row.driverName || 'مجهول'} (${row.carPlate || ''})</td>
        <td>${row.transporterName}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth' });
}

// 4. Save imported records to Supabase (creates missing master definitions dynamically)
async function saveImportedToDatabase() {
  if (!supabaseClient) {
    alert('الرجاء الاتصال بقاعدة بيانات Supabase أولاً.');
    return;
  }

  const btn = document.getElementById('btnSaveImported');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'جاري الحفظ والتهيئة...';

  try {
    let successCount = 0;

    for (const item of importedData) {
      // 1. Resolve Factory
      let factory = factories.find(f => f.name.trim() === item.factoryName.trim());
      if (!factory) {
        const { data, error } = await supabaseClient
          .from('factories')
          .insert([{ name: item.factoryName.trim() }])
          .select();
        if (error) throw error;
        factory = data[0];
        factories.push(factory);
      }

      // 2. Resolve Region
      let regionNameClean = item.regionName.trim();
      let region = regions.find(r => r.name.trim() === regionNameClean);
      if (!region) {
        const { data, error } = await supabaseClient
          .from('regions')
          .insert([{ name: regionNameClean }])
          .select();
        if (error) throw error;
        region = data[0];
        regions.push(region);
      }

      // 3. Resolve Product under this factory
      let product = products.find(p => p.name.trim() === item.productName.trim() && p.factory_id === factory.id);
      if (!product) {
        const { data, error } = await supabaseClient
          .from('factory_products')
          .insert([{ 
            factory_id: factory.id, 
            name: item.productName.trim(),
            standard_trip_weight: item.quantity || item.loadedWeight || 75
          }])
          .select();
        if (error) throw error;
        product = data[0];
        products.push(product);
      }

      // 4. Resolve Transporter
      let transporter = transporters.find(t => t.name.trim() === item.transporterName.trim());
      if (!transporter && item.transporterName) {
        const { data, error } = await supabaseClient
          .from('transporters')
          .insert([{ name: item.transporterName.trim() }])
          .select();
        if (error) throw error;
        transporter = data[0];
        transporters.push(transporter);
      }

      // 5. Insert operational record
      if (importMode === 'plans') {
        const { error } = await supabaseClient
          .from('daily_plans')
          .insert([{
            product_id: product.id,
            region_id: region.id,
            plan_date: item.date,
            planned_trips: 1,
            planned_weight_per_trip: item.quantity
          }]);
        if (error) throw error;
      } else {
        // Find matching daily plan if exists to link
        let linkedPlanId = null;
        const matchPlan = dailyPlans.find(dp => 
          dp.product_id === product.id && 
          dp.region_id === region.id && 
          dp.plan_date === item.date
        );
        if (matchPlan) linkedPlanId = matchPlan.id;

        const { error } = await supabaseClient
          .from('trips')
          .insert([{
            daily_plan_id: linkedPlanId,
            region_id: region.id,
            transporter_id: transporter ? transporter.id : null,
            trip_date: item.date,
            planned_weight_tons: item.loadedWeight,
            loaded_weight_tons: item.loadedWeight,
            loading_permission_number: item.permNo,
            waybill_number: item.waybillNo,
            driver_name: item.driverName,
            driver_phone: item.driverPhone,
            vehicle_plate: item.carPlate,
            trailer_plate: item.trailerPlate,
            notes: `مسؤول الاستلام: ${item.receiverName || ''} | رقمه: ${item.receiverPhone || ''}`
          }]);
        if (error) throw error;
      }

      successCount++;
    }

    alert(`تم حفظ عدد ${successCount} سجل بنجاح في قاعدة البيانات وتحديث الجداول!`);
    
    // Clear textarea and preview
    document.getElementById('importRawText').value = '';
    document.getElementById('importPreviewSection').style.display = 'none';
    importedData = [];

    // Reload all data
    await loadAllData();

  } catch (error) {
    console.error('Import saving failed:', error);
    alert(`حدث خطأ أثناء حفظ البيانات: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
