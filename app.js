/* Benford's Law Analyzer v4 - CSV + Excel support */
(() => {
  'use strict';

  const BENFORD_FIRST = {};
  for (let d = 1; d <= 9; d++) BENFORD_FIRST[d] = Math.log10(1 + 1 / d);
  const BENFORD_SECOND = {
    0:0.1197,1:0.1139,2:0.1088,3:0.1043,
    4:0.1003,5:0.0967,6:0.0934,7:0.0904,8:0.0876,9:0.0850
  };
  const Z_CRITICAL = 1.96;
  const CHI2_TABLE = {1:3.841,2:5.991,3:7.815,4:9.488,5:11.070,6:12.592,7:14.067,8:15.507,9:16.919,10:18.307};

  function chi2pvalue(x, df) {
    if (x <= 0) return 1;
    const k = df/2, z = Math.pow(x/(2*k),1/3);
    return 1 - normCDF((z-(1-1/(9*k)))/Math.sqrt(1/(9*k)));
  }
  function normCDF(z) {
    const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    const s=z<0?-1:1; z=Math.abs(z)/Math.SQRT2;
    const t=1/(1+p*z);
    return 0.5*(1+s*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z)));
  }

  let chartFirst=null, chartSecond=null;
  let csvData=null, csvHeaders=[];
  let workbook=null; // SheetJS workbook for Excel

  const uploadZone     = document.getElementById('upload-zone');
  const fileInput      = document.getElementById('file-input');
  const fileInfo       = document.getElementById('file-info');
  const fileNameEl     = document.getElementById('file-name');
  const sheetSel       = document.getElementById('sheet-selector');
  const sheetSelect    = document.getElementById('sheet-select');
  const columnSelector = document.getElementById('column-selector');
  const columnSelect   = document.getElementById('column-select');
  const btnAnalyze     = document.getElementById('btn-analyze');
  const spinner        = document.getElementById('spinner');
  const resultsSection = document.getElementById('results-section');

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
    });
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault(); uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    sheetSelect.addEventListener('change', () => loadSheetData(sheetSelect.value));
    btnAnalyze.addEventListener('click', runAnalysis);
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── File Handling ─────────────────────────────────────────────────────────
  function handleFile(file) {
    fileNameEl.textContent = file.name + ' (' + fmtBytes(file.size) + ')';
    fileInfo.classList.add('show');

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
      handleExcel(file);
    } else {
      handleCSV(file);
    }
  }

  // ── Excel Handling (SheetJS) ──────────────────────────────────────────────
  function handleExcel(file) {
    if (typeof XLSX === 'undefined') {
      alert('SheetJS 函式庫未載入，請確認網路連線後重新整理頁面。');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const data = new Uint8Array(e.target.result);
      workbook = XLSX.read(data, { type: 'array', cellDates: true });

      const sheets = workbook.SheetNames;
      if (sheets.length === 0) { alert('Excel 檔案沒有工作表'); return; }

      // Populate sheet selector
      sheetSelect.innerHTML = '';
      sheets.forEach(name => {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        sheetSelect.appendChild(o);
      });

      if (sheets.length > 1) {
        sheetSel.style.display = 'block';
      } else {
        sheetSel.style.display = 'none';
      }

      loadSheetData(sheets[0]);
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSheetData(sheetName) {
    if (!workbook) return;
    const sheet = workbook.Sheets[sheetName];
    // Convert to array of objects (first row = headers)
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) { alert('工作表「'+sheetName+'」沒有資料'); return; }
    csvHeaders = Object.keys(rows[0]);
    csvData = rows;
    populateColumnSelector();
  }

  // ── CSV Handling ──────────────────────────────────────────────────────────
  function handleCSV(file) {
    workbook = null;
    sheetSel.style.display = 'none';
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      if ((text.match(/\uFFFD/g)||[]).length > text.length * 0.01) {
        const r2 = new FileReader();
        r2.onload = e2 => parseCSV(e2.target.result);
        r2.readAsText(file, 'Big5');
      } else {
        parseCSV(text);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function parseCSV(text) {
    const first = text.split(/\r?\n/)[0];
    const sep = first.split('\t').length > first.split(',').length ? '\t' : ',';
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('CSV 至少需要標頭和一筆資料'); return; }
    csvHeaders = parseLine(lines[0], sep);
    csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseLine(lines[i], sep);
      const row = {};
      csvHeaders.forEach((h, j) => row[h] = vals[j] !== undefined ? vals[j] : '');
      csvData.push(row);
    }
    populateColumnSelector();
  }

  function parseLine(line, sep) {
    const r = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c==='"') { if (line[i+1]==='"') { cur+='"'; i++; } else inQ=false; } else cur+=c; }
      else { if (c==='"') inQ=true; else if (c===sep) { r.push(cur.trim()); cur=''; } else cur+=c; }
    }
    r.push(cur.trim()); return r;
  }

  function populateColumnSelector() {
    columnSelect.innerHTML = '';
    const numCols = csvHeaders.filter(h => {
      let c = 0, t = Math.min(csvData.length, 30);
      for (let i = 0; i < t; i++) { const v = extractNum(csvData[i][h]); if (v !== null && v >= 10) c++; }
      return c > t * 0.3;
    });
    (numCols.length > 0 ? numCols : csvHeaders).forEach(h => {
      const o = document.createElement('option');
      o.value = h; o.textContent = h; columnSelect.appendChild(o);
    });
    columnSelector.classList.add('show');
    btnAnalyze.classList.add('show');
  }

  // ── Number Utilities ──────────────────────────────────────────────────────
  function extractNum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) && v !== 0 ? Math.abs(v) : null;
    const n = parseFloat(String(v).replace(/[,\s$￥¥€£%()（）　]/g, ''));
    return (isNaN(n) || !isFinite(n)) ? null : Math.abs(n);
  }
  function getFirstDigit(n) {
    if (n <= 0) return null;
    const d = parseInt(n.toExponential().charAt(0));
    return (d >= 1 && d <= 9) ? d : null;
  }
  function getSecondDigit(n) {
    if (n < 10) return null;
    const e = Math.floor(Math.log10(n));
    return Math.floor(n / Math.pow(10, e) * 10) % 10;
  }

  // ── Analysis ──────────────────────────────────────────────────────────────
  function runAnalysis() {
    const col = columnSelect.value;
    if (!col || !csvData) return;
    spinner.classList.add('show'); resultsSection.classList.remove('show');

    setTimeout(() => {
      const nums = csvData.map(r => extractNum(r[col])).filter(v => v !== null && v > 0);
      if (nums.length < 10) { alert('有效數值少於10筆，請確認所選欄位包含數值資料。'); spinner.classList.remove('show'); return; }

      const f1={1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
      const f2={0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
      let n1=0, n2=0;
      nums.forEach(n => {
        const d1=getFirstDigit(n); if(d1!==null){f1[d1]++;n1++;}
        const d2=getSecondDigit(n); if(d2!==null){f2[d2]++;n2++;}
      });
      const obs1={}, obs2={};
      for(let d=1;d<=9;d++) obs1[d]=n1>0?f1[d]/n1:0;
      for(let d=0;d<=9;d++) obs2[d]=n2>0?f2[d]/n2:0;

      const z1=calcZ(obs1,BENFORD_FIRST,n1), z2=calcZ(obs2,BENFORD_SECOND,n2);
      const ch1=calcChi2(f1,BENFORD_FIRST,n1), ch2=calcChi2(f2,BENFORD_SECOND,n2);
      const a1=Object.values(z1).filter(s=>s.anomaly), a2=Object.values(z2).filter(s=>s.anomaly);

      updateStats(n1,col,a1.length,a2.length);
      renderSmoothChart('chart-first-digit',['1','2','3','4','5','6','7','8','9'],obs1,BENFORD_FIRST,{exp:'#818cf8',obs:'#fbbf24',expLabel:'Benford 預期頻率',obsLabel:'觀察頻率',fill:'rgba(251,191,36,0.08)'},'first');
      renderSmoothChart('chart-second-digit',['0','1','2','3','4','5','6','7','8','9'],obs2,BENFORD_SECOND,{exp:'#a78bfa',obs:'#34d399',expLabel:'2nd Benford 預期頻率',obsLabel:'觀察頻率',fill:'rgba(52,211,153,0.08)'},'second');
      renderChi2('chi-first',ch1,'第一位數'); renderChi2('chi-second',ch2,'第二位數');
      drawZTable('z-table-first',z1); drawZTable('z-table-second',z2);
      drawVerdict('verdict-first',z1,'第一位數',n1); drawVerdict('verdict-second',z2,'第二位數',n2);
      renderAIReport(z1,z2,ch1,ch2,n1,n2,col);
      drawOverall(z1,z2,ch1,ch2);

      spinner.classList.remove('show'); resultsSection.classList.add('show');
      resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
    }, 300);
  }

  function calcZ(obs,exp,n){const r={};Object.keys(exp).forEach(d=>{const po=obs[d]||0,pe=exp[d],den=Math.sqrt((pe*(1-pe))/n),z=den>0?(po-pe)/den:0;r[d]={digit:d,observed:po,expected:pe,count:Math.round(po*n),z,anomaly:Math.abs(z)>Z_CRITICAL};});return r;}
  function calcChi2(counts,expected,n){const digits=Object.keys(expected).map(Number).sort((a,b)=>a-b);let chi2=0;const details=[];digits.forEach(d=>{const O=counts[d]||0,E=expected[d]*n,c=E>0?Math.pow(O-E,2)/E:0;chi2+=c;details.push({digit:d,O,E,contrib:c});});const df=digits.length-1,critical=CHI2_TABLE[df]||CHI2_TABLE[10];return{chi2,df,critical,pval:chi2pvalue(chi2,df),reject:chi2>critical,details};}

  function updateStats(total,col,a1,a2){
    document.getElementById('stat-total').textContent=total.toLocaleString();
    document.getElementById('stat-column').textContent=col.length>12?col.slice(0,12)+'…':col;
    const fa=document.getElementById('stat-first-anomaly'),sa=document.getElementById('stat-second-anomaly');
    fa.textContent=a1;fa.style.color=a1>0?'#f87171':'#34d399';fa.style.webkitTextFillColor=fa.style.color;
    sa.textContent=a2;sa.style.color=a2>0?'#f87171':'#34d399';sa.style.webkitTextFillColor=sa.style.color;
  }

  function renderSmoothChart(canvasId,labels,obs,exp,colors,which){
    const ctx=document.getElementById(canvasId).getContext('2d');
    if(which==='first'&&chartFirst)chartFirst.destroy();
    if(which==='second'&&chartSecond)chartSecond.destroy();
    const ch=new Chart(ctx,{type:'line',data:{labels,datasets:[
      {label:colors.expLabel,data:labels.map(d=>+(exp[d]*100).toFixed(3)),borderColor:colors.exp,backgroundColor:'transparent',borderWidth:3,pointRadius:6,pointBackgroundColor:colors.exp,pointBorderColor:'#0a0e1a',pointBorderWidth:2,pointHoverRadius:9,tension:0.4,order:2},
      {label:colors.obsLabel,data:labels.map(d=>+((obs[d]||0)*100).toFixed(3)),borderColor:colors.obs,backgroundColor:colors.fill,fill:true,borderWidth:3,pointRadius:6,pointBackgroundColor:colors.obs,pointBorderColor:'#0a0e1a',pointBorderWidth:2,pointHoverRadius:9,tension:0.4,order:1}
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{position:'top',labels:{color:'#94a3b8',font:{family:'Inter',size:13},padding:20,usePointStyle:true}},tooltip:{backgroundColor:'rgba(17,24,39,0.95)',titleColor:'#f1f5f9',bodyColor:'#94a3b8',borderColor:'rgba(99,102,241,0.3)',borderWidth:1,padding:14,cornerRadius:10,callbacks:{label:c=>' '+c.dataset.label+': '+c.parsed.y.toFixed(2)+'%',afterBody:items=>{if(items.length>=2){const diff=(items[1].parsed.y-items[0].parsed.y).toFixed(2);return['','差異: '+(parseFloat(diff)>=0?'+':'')+diff+'%'];}return[];}}}},scales:{x:{grid:{color:'rgba(99,102,241,0.06)'},ticks:{color:'#94a3b8',font:{family:'JetBrains Mono',size:14,weight:'600'}}},y:{beginAtZero:true,grid:{color:'rgba(99,102,241,0.06)'},ticks:{color:'#94a3b8',callback:v=>v+'%'},title:{display:true,text:'頻率 (%)',color:'#64748b',font:{size:12}}}}}});
    if(which==='first')chartFirst=ch;else chartSecond=ch;
  }

  function renderChi2(id,r,label){
    const el=document.getElementById(id);
    const pStr=r.pval<0.0001?'< 0.0001':r.pval.toFixed(4);
    const cls=r.reject?'fail':'pass',icon=r.reject?'⚠️':'✅';
    const msg=r.reject?'χ² = <strong>'+r.chi2.toFixed(4)+'</strong> &gt; 臨界值 '+r.critical.toFixed(3)+'（df='+r.df+'，α=0.05），p = '+pStr+'。<br><strong>拒絕虛無假設</strong>：'+label+'的分布與班佛定律有顯著差異。':'χ² = <strong>'+r.chi2.toFixed(4)+'</strong> ≤ 臨界值 '+r.critical.toFixed(3)+'（df='+r.df+'，α=0.05），p = '+pStr+'。<br><strong>無法拒絕虛無假設</strong>：'+label+'的分布與班佛定律無顯著差異。';
    let table='<div class="z-table-wrapper" style="margin-top:1rem"><table class="z-table"><thead><tr><th>數字</th><th>觀察(O)</th><th>預期(E)</th><th>(O-E)²/E</th></tr></thead><tbody>';
    r.details.forEach(d=>{const big=d.contrib>3.841;table+='<tr><td class="digit-col">'+d.digit+'</td><td>'+d.O+'</td><td>'+d.E.toFixed(2)+'</td><td class="'+(big?'anomaly':'')+'">'+d.contrib.toFixed(4)+'</td></tr>';});
    el.innerHTML='<div class="verdict '+cls+'"><h3>'+icon+' 卡方檢定結果</h3><p>'+msg+'</p></div>'+table+'</tbody></table></div>';
  }

  function drawZTable(id,stats){
    const digits=Object.keys(stats).sort((a,b)=>Number(a)-Number(b));
    let html='<thead><tr><th>數字</th><th>觀察次數</th><th>觀察頻率</th><th>預期頻率</th><th>差異</th><th>Z 統計量</th><th>判定</th></tr></thead><tbody>';
    digits.forEach(d=>{const s=stats[d],diff=((s.observed-s.expected)*100).toFixed(2),sign=parseFloat(diff)>0?'+':'',ac=s.anomaly?'anomaly':'normal';html+='<tr><td class="digit-col">'+d+'</td><td>'+s.count+'</td><td>'+(s.observed*100).toFixed(2)+'%</td><td>'+(s.expected*100).toFixed(2)+'%</td><td class="'+(Math.abs(parseFloat(diff))>2?'anomaly':'')+'">'+sign+diff+'%</td><td class="'+ac+'">'+s.z.toFixed(4)+'</td><td class="'+ac+'">'+(s.anomaly?'⚠️ 異常':'✅ 正常')+'</td></tr>';});
    document.getElementById(id).innerHTML=html+'</tbody>';
  }

  function drawVerdict(id,stats,label,n){
    const anomalies=Object.entries(stats).filter(([,s])=>s.anomaly),el=document.getElementById(id);
    if(anomalies.length===0){el.innerHTML='<div class="verdict pass"><h3>✅ '+label+' Z 檢定：符合班佛定律</h3><p>所有位數 |Z| ≤ 1.96（n = '+n.toLocaleString()+'）</p></div>';}
    else{const list=anomalies.map(([d,s])=>'<li>數字 '+d+'：Z = '+s.z.toFixed(4)+'（觀察 '+(s.observed*100).toFixed(2)+'% vs 預期 '+(s.expected*100).toFixed(2)+'%，'+(s.z>0?'偏高':'偏低')+'）</li>').join('');el.innerHTML='<div class="verdict fail"><h3>⚠️ '+label+' Z 檢定：不完全符合</h3><ul class="anomaly-list">'+list+'</ul></div>';}
  }

  function fmtP(p){return p<0.0001?'< 0.0001':p.toFixed(4);}

  function renderAIReport(z1,z2,ch1,ch2,n1,n2,colName){
    const el=document.getElementById('ai-report');
    const a1=Object.entries(z1).filter(([,s])=>s.anomaly);
    const a2=Object.entries(z2).filter(([,s])=>s.anomaly);
    let html='<div style="line-height:1.9;color:var(--text-secondary);font-size:0.92rem;">';
    html+='<h4 style="color:var(--accent-primary);margin:1rem 0 0.5rem;">📊 一、資料品質評估</h4>';
    html+=n1>=500?'<p>✅ <strong>樣本量充足</strong>：共 '+n1.toLocaleString()+' 筆，統計檢定具有可靠的統計檢力。</p>':n1>=100?'<p>⚠️ <strong>樣本量適中</strong>：共 '+n1.toLocaleString()+' 筆，建議增加至 500 筆以上以提高檢力。</p>':'<p>🚨 <strong>樣本量偏少</strong>：僅 '+n1.toLocaleString()+' 筆，分析結果應謹慎解讀。</p>';
    html+='<h4 style="color:var(--accent-primary);margin:1.5rem 0 0.5rem;">🔍 二、第一位數分析發現</h4>';
    if(a1.length===0&&!ch1.reject){html+='<p>✅ 第一位數觀察分布與 Benford 定律高度吻合（χ²='+ch1.chi2.toFixed(3)+'，p='+fmtP(ch1.pval)+'）。</p>';}
    else{html+='<p>⚠️ 發現偏異：</p><ul style="padding-left:1.5rem;">';a1.forEach(([d,s])=>{html+='<li><strong>數字 '+d+'</strong>：觀察 '+(s.observed*100).toFixed(2)+'%（預期 '+(s.expected*100).toFixed(2)+'%），'+(s.z>0?'偏高':'偏低')+'。</li>';});html+='</ul>';if(ch1.reject)html+='<p>卡方檢定顯著（χ²='+ch1.chi2.toFixed(3)+'，p='+fmtP(ch1.pval)+'），整體分布與預期有統計顯著差異。</p>';}
    html+='<h4 style="color:var(--accent-primary);margin:1.5rem 0 0.5rem;">🔬 三、第二位數分析發現</h4>';
    if(a2.length===0&&!ch2.reject){html+='<p>✅ 第二位數觀察分布一致（χ²='+ch2.chi2.toFixed(3)+'，p='+fmtP(ch2.pval)+'）。</p>';}
    else{const lowHi=a2.filter(([d,s])=>parseInt(d)<=2&&s.z>0),hiLo=a2.filter(([d,s])=>parseInt(d)>=7&&s.z<0),loLo=a2.filter(([d,s])=>parseInt(d)<=2&&s.z<0),hiHi=a2.filter(([d,s])=>parseInt(d)>=7&&s.z>0);html+='<ul style="padding-left:1.5rem;">';a2.forEach(([d,s])=>html+='<li><strong>數字 '+d+'</strong>：'+(s.z>0?'偏高':'偏低')+'（Z='+s.z.toFixed(3)+'）</li>');html+='</ul>';if(lowHi.length>0&&hiLo.length>0)html+='<p>🔴 <strong>疑似灌水拉高</strong>：小數字（0-2）過多、大數字（7-9）過少。</p>';else if(loLo.length>0&&hiHi.length>0)html+='<p>🔴 <strong>疑似壓低數據</strong>：小數字偏少、大數字偏多。</p>';else html+='<p>⚠️ 部分偏異，未呈現單一方向性操作。</p>';}
    html+='<h4 style="color:#f87171;margin:1.5rem 0 0.5rem;">⚠️ 四、問題點識別</h4>';
    const problems=[];
    if(n1<100)problems.push('樣本量過少（'+n1+'筆），統計效力不足。');
    if(ch1.reject)problems.push('第一位數卡方顯著（p='+fmtP(ch1.pval)+'），可能存在非自然數據。');
    if(ch2.reject)problems.push('第二位數卡方顯著（p='+fmtP(ch2.pval)+'），需進一步調查。');
    if(a1.length>3)problems.push('第一位數有 '+a1.length+' 個異常，整體偏差嚴重。');
    if(a2.length>3)problems.push('第二位數有 '+a2.length+' 個異常，高度懷疑數據品質。');
    html+=problems.length===0?'<p>✅ 未發現顯著問題，數據分布與自然生成資料一致。</p>':'<ol style="padding-left:1.5rem;">'+problems.map(p=>'<li style="margin-bottom:0.5rem;">'+p+'</li>').join('')+'</ol>';
    html+='<h4 style="color:#34d399;margin:1.5rem 0 0.5rem;">💡 五、改善建議</h4>';
    const sugg=[];
    if(n1<500)sugg.push('增加樣本量至 500 筆以上以提升統計檢力。');
    if(ch1.reject||ch2.reject){sugg.push('檢查資料完整性，確認是否存在擷取錯誤或重複值。');sugg.push('比對多個獨立來源交叉驗證異常數值。');}
    if(a1.length>0||a2.length>0){sugg.push('針對異常位數回溯原始紀錄。');sugg.push('依時間或地區分組分別分析，定位異常子集。');}
    sugg.push('可進一步加入前兩位數字組合檢定（first-two digits test）。');
    sugg.push('建立定期 Benford 分析的持續監控機制。');
    html+='<ol style="padding-left:1.5rem;">'+sugg.map(s=>'<li style="margin-bottom:0.5rem;">'+s+'</li>').join('')+'</ol>';
    html+='<h4 style="color:var(--accent-primary);margin:1.5rem 0 0.5rem;">📝 六、總結</h4>';
    const allOk=a1.length===0&&a2.length===0&&!ch1.reject&&!ch2.reject;
    html+=allOk?'<p>「<strong>'+colName+'</strong>」欄位數字分布符合預期，<strong>未發現數據造假或操縱的統計證據</strong>。</p>':'<p>「<strong>'+colName+'</strong>」欄位存在偏離。'+(ch1.reject||ch2.reject?'<strong>卡方檢定已達顯著水準</strong>，建議調查原始數據。':'建議優先排除資料品質問題後重新分析。')+'</p>';
    el.innerHTML=html+'</div>';
  }

  function drawOverall(z1,z2,ch1,ch2){
    const a1=Object.values(z1).filter(s=>s.anomaly),a2=Object.values(z2).filter(s=>s.anomaly);
    const chiReject=ch1.reject||ch2.reject,zFail=a1.length+a2.length;
    let cls,icon,title,desc;
    if(!chiReject&&zFail===0){cls='pass';icon='✅';title='此資料完全符合班佛定律';desc='卡方及 Z 統計量均未發現異常，數據分布自然，未見人為操縱跡象。';}
    else{const sev=(chiReject&&zFail>3)?'fail':'warning';cls=sev;icon=sev==='fail'?'🚨':'⚠️';title='此資料'+(sev==='fail'?'顯著':'部分')+'偏離班佛定律';const parts=[];if(ch1.reject)parts.push('第一位數卡方顯著（p='+fmtP(ch1.pval)+')');if(ch2.reject)parts.push('第二位數卡方顯著（p='+fmtP(ch2.pval)+')');if(a1.length>0)parts.push('第一 Z 異常 '+a1.length+' 個');if(a2.length>0)parts.push('第二 Z 異常 '+a2.length+' 個');desc=parts.join('；')+'。詳見上方 AI 分析報告。';}
    document.getElementById('overall-verdict').innerHTML='<div class="verdict '+cls+'"><h3>'+icon+' '+title+'</h3><p>'+desc+'</p></div>';
  }

  function fmtBytes(b){if(!b)return '0 B';const k=1024,s=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(1)+' '+s[i];}
  init();
})();
