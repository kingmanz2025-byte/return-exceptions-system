const $=id=>document.getElementById(id);
const state={user:null,branches:[],transferBranches:[],requests:[],transfers:[],users:[],audit:[],dashboard:null};

const roleName=r=>({system_admin:'مدير النظام',branch_user:'مستخدم عادي',report_viewer:'مراقب التقارير'}[r]||r);
const statusName=s=>({pending:'معلق',approved:'معتمد',rejected:'مرفوض'}[s]||s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
const currentPeriod=()=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const year=parts.find(x=>x.type==='year')?.value;
 const month=parts.find(x=>x.type==='month')?.value;
 return year&&month?`${year}-${month}`:new Date().toISOString().slice(0,7);
};

async function api(path,opts={}){
 const res=await fetch('/api/'+path,{...opts,credentials:'same-origin',headers:{'content-type':'application/json',...(opts.headers||{})}});
 let data={};
 try{data=await res.json()}catch{}
 if(!res.ok)throw Error(data.error||`خطأ بالخادم (${res.status})`);
 return data;
}

function message(s,error=false){
 $('globalMsg').textContent=s;
 $('globalMsg').classList.remove('hidden');
 $('globalMsg').classList.toggle('error',error);
 setTimeout(()=>$('globalMsg').classList.add('hidden'),6000);
}

function setPage(p){
 document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===p));
 document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));
 if(p==='dashboard'&&state.user?.role==='system_admin')renderDashboard();
 if(p==='requests')renderRequests();
 if(p==='transfers'&&state.user?.role==='system_admin')renderTransfers();
 if(p==='users'&&state.user?.role==='system_admin')renderUsers();
 if(p==='audit'&&state.user?.role==='system_admin')renderAudit();
 if(p==='reports'&&state.user?.role==='system_admin')loadReports();
}

document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
document.addEventListener('click',e=>{const b=e.target.closest('[data-go-page]');if(b)setPage(b.dataset.goPage)});

async function login(e){
 e.preventDefault();
 $('loginError').textContent='';
 try{
  await api('login',{method:'POST',body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})});
  await startApp();
 }catch(err){$('loginError').textContent=err.message}
}

$('loginForm').addEventListener('submit',login);

$('logoutBtn').onclick=async()=>{
 try{await api('logout',{method:'POST'})}
 finally{location.reload()}
};

async function startApp(){
 const me=await api('me');
 state.user=me.user;
 $('loginView').classList.add('hidden');
 $('appView').classList.remove('hidden');
 $('userInfo').textContent=`${me.user.display_name||me.user.username} • ${roleName(me.user.role)}`;
 $('usersNav').classList.toggle('hidden',me.user.role!=='system_admin');
 $('auditNav').classList.toggle('hidden',me.user.role!=='system_admin');
 $('reportsNav').classList.toggle('hidden',me.user.role!=='system_admin');
 $('settingsNav')?.classList.toggle('hidden',me.user.role!=='system_admin');
 $('nav').querySelectorAll('button').forEach(b=>{const adminOnly=['transfers','reports','users','audit','settings'].includes(b.dataset.page);b.classList.toggle('hidden',adminOnly&&me.user.role!=='system_admin');});
 $('newRequestBtn').classList.toggle('hidden',me.user.role==='report_viewer');
 $('transferCreate').classList.toggle('hidden',me.user.role!=='system_admin');
 await refreshAll();
}

async function refreshAll(){
 try{
  const [b,r]=await Promise.all([api('branches'),api('requests')]);
  const t=state.user.role==='system_admin'?await api('transfers'):{transfers:[]};
  state.branches=b.branches||[];
  state.requests=r.requests||[];
  state.transfers=t.transfers||[];

  if(state.user.role==='system_admin'){
   try{
    const d=await api('dashboard?period='+currentPeriod());
    state.dashboard=d;
    state.branches=d.branches||state.branches;
   }catch(e){state.dashboard=null}
  }else{state.dashboard=null}

  if(state.user.role==='system_admin'){
   try{const tb=await api('transfer-branches');state.transferBranches=tb.branches||[];}catch(e){state.transferBranches=[];message(e.message,true)}
  }else{state.transferBranches=[];}
  fillBranchSelects();
  renderDashboard();
  renderRequests();
  renderTransfers();

  if(state.user.role==='system_admin'){
   try{const u=await api('users');state.users=u.users||[]}catch{}
   renderUsers();
  }

  if(state.user.role==='system_admin'){
   try{const a=await api('audit');state.audit=a.logs||[]}catch{}
   renderAudit();
  }
 }catch(e){message(e.message,true)}
}

function fillBranchSelects(){
 const own=[...state.branches].sort((a,b)=>Number(a.id)-Number(b.id)).map(b=>`<option value="${b.id}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
 ['reqBranch','fromBranch','userBranches'].forEach(id=>{const el=$(id);if(el)el.innerHTML=own;});
 updateTransferTargets();
}
function updateTransferTargets(){
 const from=$('fromBranch');
 const to=$('toBranch');
 if(!from||!to)return;
 const fromId=Number(from.value);
 const targets=[...state.transferBranches].filter(b=>Number(b.id)!==fromId).sort((a,b)=>Number(a.id)-Number(b.id));
 to.innerHTML=targets.map(b=>`<option value="${b.id}">${esc(b.name)} (${esc(b.code)})</option>`).join('')||'<option value="">لا توجد فروع مستفيدة متاحة</option>';
}

function renderDashboard(){
 const branches=state.branches;
 const req=state.requests;
 const transfers=state.transfers;
 const c=state.dashboard?.counts||{
  total:req.length,
  pending:req.filter(x=>x.status==='pending').length,
  approved:req.filter(x=>x.status==='approved').length,
  rejected:req.filter(x=>x.status==='rejected').length
 };
 const total=Number(c.total??req.length)||0;
 const pending=Number(c.pending??req.filter(x=>x.status==='pending').length)||0;
 const approved=Number(c.approved??req.filter(x=>x.status==='approved').length)||0;
 const rejected=Number(c.rejected??req.filter(x=>x.status==='rejected').length)||0;
 const quota=branches.reduce((n,b)=>n+Number(b.quota??b.monthly_quota??3),0);
 const incoming=branches.reduce((n,b)=>n+Number(b.transferred_in||0),0);
 const outgoing=branches.reduce((n,b)=>n+Number(b.transferred_out||0),0);
 const used=branches.reduce((n,b)=>n+Number(b.used||0),0);
 const available=branches.reduce((n,b)=>n+Number(b.quota??b.monthly_quota??3)+Number(b.transferred_in||0)-Number(b.transferred_out||0)-Number(b.used||0),0);
 $('branchCount').textContent=branches.length;
 $('quotaCount').textContent=quota;
 $('requestCount').textContent=total;
 $('pendingCount').textContent=pending;
 $('periodLabel').textContent='ملخص الفترة: '+currentPeriod();
 if($('approvedCount'))$('approvedCount').textContent=approved;
 if($('rejectedCount'))$('rejectedCount').textContent=rejected;
 if($('availableCount'))$('availableCount').textContent=available;
 if($('usedCount'))$('usedCount').textContent=used;
 if($('incomingCount'))$('incomingCount').textContent=incoming;
 if($('outgoingCount'))$('outgoingCount').textContent=outgoing;
 const pct=total?Math.round(approved/total*100):0;
 if($('approvalRate'))$('approvalRate').textContent=pct+'%';
 if($('approvalBar'))$('approvalBar').style.width=pct+'%';
 if($('pendingBar'))$('pendingBar').style.width=(total?Math.round(pending/total*100):0)+'%';
 if($('rejectedBar'))$('rejectedBar').style.width=(total?Math.round(rejected/total*100):0)+'%';
 const q=($('branchSearch').value||'').toLowerCase();
 $('branchRows').innerHTML=branches
  .filter(b=>(b.name+' '+b.code).toLowerCase().includes(q))
  .map(b=>{
   const base=Number(b.quota??b.monthly_quota??3),inc=Number(b.transferred_in||0),out=Number(b.transferred_out||0),u=Number(b.used||0),av=base+inc-out-u;
   return `<tr><td>${esc(b.code)}</td><td>${esc(b.name)}</td><td>${base}</td><td>${inc}</td><td>${out}</td><td>${u}</td><td><b class="${av<0?'negative':''}">${av}</b></td></tr>`;
  }).join('')||'<tr><td colspan="7">لا توجد فروع متاحة لحسابك</td></tr>';
 if($('recentRequests')){
  $('recentRequests').innerHTML=[...req].sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||''))).slice(0,5).map(r=>`
   <div class="dash-row"><div><b>${esc(r.branch_name||'فرع غير محدد')}</b><small>${esc(r.id)} · ${esc(r.creator_name||'')}</small></div><span class="pill ${esc(r.status)}">${statusName(r.status)}</span><strong>${money(r.amount)} ج.م</strong></div>`
  ).join('')||'<p class="muted">لا توجد طلبات مسجلة حتى الآن.</p>';
 }
 if($('recentTransfers')){
  $('recentTransfers').innerHTML=state.user?.role==='system_admin'
   ?[...transfers].slice(0,5).map(t=>`<div class="dash-row"><div><b>${esc(t.from_branch_name||'')} ← ${esc(t.to_branch_name||'')}</b><small>${esc(t.id)} · ${esc(t.created_at||'')}</small></div><span class="pill ${esc(t.status)}">${statusName(t.status)}</span><strong>${Number(t.quantity||0)} حصة</strong></div>`).join('')||'<p class="muted">لا توجد تحويلات مسجلة.</p>'
   :'<p class="muted">تظهر متابعة التحويلات التفصيلية لمدير النظام ومراقب التقارير.</p>';
 }
}
$('branchSearch').oninput=renderDashboard;
$('fromBranch').addEventListener('change',updateTransferTargets);
$('loadReportsBtn').onclick=loadReports;
document.querySelectorAll('[data-export]').forEach(b=>b.addEventListener('click',()=>exportReport(b.dataset.export,b.dataset.filename)));
$('refreshBtn').onclick=refreshAll;

function renderRequests(){
 const q=($('requestSearch').value||'').toLowerCase();
 const s=$('statusFilter').value;

 const rows=state.requests.filter(r=>
  (!s||r.status===s)&&
  [r.id,r.invoice_number,r.branch_name,r.branch_code,r.customer_name,r.reason].join(' ').toLowerCase().includes(q)
 );

 $('requestList').innerHTML=rows.map(r=>`
  <article class="item">
   <div class="itemtop">
    <div>
     <h3>${esc(r.id)} • ${esc(r.branch_name)} (${esc(r.branch_code)})</h3>
     <p>الفاتورة: ${esc(r.invoice_number)} • ${esc(r.created_at)}</p>
     <p><b>مقدم الطلب:</b> ${esc(r.creator_name||'غير محدد')}</p>
    </div>
    <span class="pill ${r.status}">${statusName(r.status)}</span>
   </div>
   <p><b>السبب:</b> ${esc(r.reason)} • <b>القيمة:</b> ${money(r.amount)} ج.م</p>
   <p>${esc(r.details)}</p>
   ${r.customer_name?`<p>العميل: ${esc(r.customer_name)}</p>`:''}
   ${r.decision_note?`<p>ملاحظة القرار: ${esc(r.decision_note)}</p>`:''}
   ${r.status==='pending'&&state.user.role==='system_admin'?`
    <div class="itemactions">
     <button class="approve" data-decision="approve" data-id="${esc(r.id)}">اعتماد</button>
     <button class="reject" data-decision="reject" data-id="${esc(r.id)}">رفض</button>
    </div>`:''}
  </article>
 `).join('')||'<div class="item">لا توجد طلبات مطابقة.</div>';

 document.querySelectorAll('[data-decision]').forEach(b=>
  b.onclick=()=>decide(b.dataset.id,b.dataset.decision)
 );
}

$('requestSearch').oninput=renderRequests;
$('statusFilter').onchange=renderRequests;

$('newRequestBtn').onclick=()=>{
 $('requestModal').classList.remove('hidden');
};

$('closeModal').onclick=()=>{
 $('requestModal').classList.add('hidden');
};

$('requestForm').onsubmit=async e=>{
 e.preventDefault();
 try{
  const branchId=Number($('reqBranch').value);
  const result=await api('requests',{
   method:'POST',
   body:JSON.stringify({
    branchId,
    invoiceNumber:$('invoice').value.trim(),
    customerName:$('customer').value.trim(),
    amount:Number($('amount').value),
    reason:$('reason').value,
    details:$('details').value.trim(),
    period:currentPeriod()
   })
  });

  $('requestModal').classList.add('hidden');
  e.target.reset();
  message(`تم إرسال الطلب ${result.id} بنجاح`);
  await refreshAll();
 }catch(err){message(err.message,true)}
};

async function decide(id,decision){
 let note='';
 if(decision==='reject'||confirm('هل تريد اعتماد الطلب؟')){
  if(decision==='reject'||confirm('هل توجد ملاحظة للقرار؟ اضغط إلغاء لتجاوز الملاحظة.')){
   note=prompt('ملاحظة القرار (مطلوبة عند الموافقة فوق الحصة):')||'';
  }
  try{
   await api('decisions',{
    method:'POST',
    body:JSON.stringify({id,decision,note})
   });
   message('تم تسجيل القرار');
   await refreshAll();
  }catch(e){message(e.message,true)}
 }
}

$('transferForm').onsubmit=async e=>{
 e.preventDefault();
 try{
  const result=await api('transfers',{
   method:'POST',
   body:JSON.stringify({
    fromBranchId:Number($('fromBranch').value),
    toBranchId:Number($('toBranch').value),
    quantity:Number($('transferQty').value),
    reason:$('transferReason').value.trim(),
    period:currentPeriod()
   })
  });
  e.target.reset();
  message(`تم إرسال طلب التحويل ${result.id}`);
  await refreshAll();
 }catch(err){message(err.message,true)}
};

function renderTransfers(){
 $('transferList').innerHTML=state.transfers.map(t=>`
  <article class="item">
   <div class="itemtop">
    <h3>${esc(t.id)}</h3>
    <span class="pill ${t.status}">${statusName(t.status)}</span>
   </div>
   <p>${esc(t.from_branch_name)} ← مانح | ${esc(t.to_branch_name)} ← مستفيد</p>
   <p>الكمية: ${t.quantity} • الفترة: ${esc(t.period)}</p>
   <p>${esc(t.reason)}</p>
   <p><b>مقدم التحويل:</b> ${esc(t.requester_name||'غير محدد')} • <b>تاريخ الطلب:</b> ${esc(t.created_at||'')}</p>
   ${t.decided_by_name?`<p><b>صاحب القرار:</b> ${esc(t.decided_by_name)} • ${esc(t.decided_at||'')}</p>`:''}
   ${t.decision_note?`<p><b>ملاحظة القرار:</b> ${esc(t.decision_note)}</p>`:''}
   ${state.user.role==='system_admin'&&t.status==='pending'?`
    <div class="itemactions">
     <button class="approve" data-transfer="approve" data-id="${esc(t.id)}">اعتماد</button>
     <button class="reject" data-transfer="reject" data-id="${esc(t.id)}">رفض</button>
    </div>`:''}
  </article>
 `).join('')||'<div class="item">لا توجد تحويلات.</div>';

 document.querySelectorAll('[data-transfer]').forEach(b=>
  b.onclick=async()=>{
   let note=prompt('ملاحظة القرار (اختياري):')||'';
   try{
    await api('transfers/'+encodeURIComponent(b.dataset.id),{
     method:'POST',
     body:JSON.stringify({decision:b.dataset.transfer,note})
    });
    message('تم تسجيل القرار');
    await refreshAll();
   }catch(e){message(e.message,true)}
  }
 );
}

$('userForm').onsubmit=async e=>{
 e.preventDefault();
 try{
  const branchIds=[...$('userBranches').selectedOptions].map(x=>Number(x.value));
  await api('users',{
   method:'POST',
   body:JSON.stringify({
    username:$('newUsername').value.trim(),
    displayName:$('newDisplayName').value.trim(),
    password:$('newPassword').value,
    role:$('newRole').value,
    branchIds
   })
  });
  e.target.reset();
  message('تم إنشاء المستخدم');
  await refreshAll();
 }catch(err){message(err.message,true)}
};

function renderUsers(){
 $('userList').innerHTML=state.users.map(u=>`
  <article class="item">
   <div class="itemtop">
    <h3>${esc(u.display_name)}</h3>
    <span class="pill">${roleName(u.role)}</span>
   </div>
   <p>${esc(u.username)} • ${u.is_active?'نشط':'موقوف'}</p>
  </article>
 `).join('')||'<div class="item">لا يوجد مستخدمون آخرون.</div>';
}

async function loadReports(){
 const period=$('reportPeriod').value||currentPeriod();
 $('reportPeriod').value=period;
 try{
  const d=await api('reports?period='+encodeURIComponent(period));
  const statusLabel=s=>({pending:'معلق',approved:'معتمد',rejected:'مرفوض'}[s]||s);
  $('balanceReportRows').innerHTML=(d.balances||[]).map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${x.quota}</td><td>${x.transferred_in}</td><td>${x.transferred_out}</td><td>${x.used}</td><td>${x.available}</td></tr>`).join('')||'<tr><td colspan="7">لا توجد بيانات</td></tr>';
  $('requestReportRows').innerHTML=(d.requests||[]).map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.period)}</td><td>${esc(x.branch_code)}</td><td>${esc(x.branch_name)}</td><td>${esc(x.invoice_number)}</td><td>${esc(x.customer_name)}</td><td>${money(x.amount)}</td><td>${esc(x.reason)}</td><td>${statusLabel(x.status)}</td><td>${esc(x.creator_name)}</td><td>${esc(x.decision_maker)}</td><td>${esc(x.created_at)}</td><td>${esc(x.decision_note)}</td></tr>`).join('')||'<tr><td colspan="13">لا توجد طلبات في الفترة المحددة</td></tr>';
  $('transferReportRows').innerHTML=(d.transfers||[]).map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.period)}</td><td>${esc(x.from_code)} - ${esc(x.from_name)}</td><td>${esc(x.to_code)} - ${esc(x.to_name)}</td><td>${x.quantity}</td><td>${statusLabel(x.status)}</td><td>${esc(x.reason)}</td><td>${esc(x.requester_name)}</td><td>${esc(x.decision_maker)}</td><td>${esc(x.created_at)}</td><td>${esc(x.decided_at)}</td></tr>`).join('')||'<tr><td colspan="11">لا توجد تحويلات في الفترة المحددة</td></tr>';
 }catch(e){message(e.message,true)}
}

function exportReport(tableId,fileName){
 const table=$(tableId);
 if(!table)return;
 const content='<!doctype html><html><head><meta charset="utf-8"></head><body dir="rtl">'+table.outerHTML+'</body></html>';
 const blob=new Blob(['\ufeff',content],{type:'application/vnd.ms-excel;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=fileName+'-'+($('reportPeriod').value||currentPeriod())+'.xls';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

function renderAudit(){
 $('auditList').innerHTML=state.audit.map(a=>`
  <article class="item">
   <div class="itemtop">
    <h3>${esc(a.action)}</h3>
    <span class="pill">${esc(a.display_name||'النظام')}</span>
   </div>
   <p>${esc(a.entity_type)} • ${esc(a.entity_id)}</p>
   <p>${esc(a.created_at)} • ${esc(a.details_json)}</p>
  </article>
 `).join('')||'<div class="item">لا توجد حركات مسجلة.</div>';
}

$('setupForm').addEventListener('submit',async e=>{
 e.preventDefault();

 $('setupError').textContent='';

 const btn=e.submitter;
 if(btn)btn.disabled=true;

 const username=$('setupUsername').value.trim();

 try{
  await api('setup',{
   method:'POST',
   body:JSON.stringify({
    setupKey:$('setupKey').value,
    username,
    displayName:$('setupDisplayName').value.trim(),
    password:$('setupPassword').value
   })
  });

  $('setupForm').reset();
  $('setupView').classList.add('hidden');
  $('loginView').classList.remove('hidden');

  $('username').value=username;
  $('loginError').textContent=
   'تم إنشاء المدير بنجاح. سجل الدخول بكلمة المرور التي اخترتها.';

 }catch(err){
  $('setupError').textContent=err.message;
 }finally{
  if(btn)btn.disabled=false;
 }
});

(async()=>{
 $('appView').classList.add('hidden');
 $('loginView').classList.add('hidden');
 $('setupView').classList.add('hidden');

 try{
  const status=await api('setup-status');

  if(status.setupRequired){
   $('setupView').classList.remove('hidden');
   return;
  }

  try{
   await api('me');
   await startApp();
  }catch{
   $('loginView').classList.remove('hidden');
  }

 }catch(err){
  $('loginView').classList.remove('hidden');
  $('loginError').textContent=
   'تعذر التحقق من إعداد النظام: '+err.message;
 }
})();

if('serviceWorker'in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

// Egypt live clock and prayer times
async function updateSiteClock(){const d=new Date();if($('liveClock'))$('liveClock').textContent=new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(d);if($('liveDate'))$('liveDate').textContent=new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(d)+' • '+new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{timeZone:'Africa/Cairo',year:'numeric',month:'long',day:'numeric'}).format(d);}
async function updatePrayerTimes(){try{const r=await fetch('https://api.aladhan.com/v1/timings/'+Math.floor(Date.now()/1000)+'?latitude=30.0444&longitude=31.2357&method=5');const j=await r.json(),t=j.data.timings;const n=[['الفجر','Fajr'],['الشروق','Sunrise'],['الظهر','Dhuhr'],['العصر','Asr'],['المغرب','Maghrib'],['العشاء','Isha']];const m=new Date().getHours()*60+new Date().getMinutes();let next=n.map(x=>({name:x[0],v:t[x[1]]})).map(x=>({...x,min:Number(x.v.slice(0,2))*60+Number(x.v.slice(3,5))})).find(x=>x.min>m);if(!next)next={name:'الفجر',min:Number(t.Fajr.slice(0,2))*60+Number(t.Fajr.slice(3,5))+1440};const left=next.min-m;$('prayerLine').textContent='الصلاة القادمة: '+next.name+' بعد '+Math.floor(left/60)+' س '+left%60+' د';}catch{$('prayerLine').textContent='مواقيت الصلاة – القاهرة';}}
setInterval(updateSiteClock,1000);updateSiteClock();updatePrayerTimes();setInterval(updatePrayerTimes,6*60*60*1000);
