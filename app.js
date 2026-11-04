
const $=id=>document.getElementById(id);
const state={user:null,branches:[],requests:[],transfers:[],users:[],audit:[],dashboard:null};

const roleName=r=>({system_admin:'مدير النظام',branch_user:'مسؤول الفرع',report_viewer:'مراقب التقارير'}[r]||r);
const statusName=s=>({pending:'معلق',approved:'معتمد',rejected:'مرفوض'}[s]||s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('ar-EG',{maximumFractionDigits:2});
const currentPeriod=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date());

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
 if(p==='dashboard')renderDashboard();
 if(p==='requests')renderRequests();
 if(p==='transfers')renderTransfers();
 if(p==='users')renderUsers();
 if(p==='audit')renderAudit();
}

document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));

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
 $('auditNav').classList.toggle('hidden',!['system_admin','report_viewer'].includes(me.user.role));
 $('newRequestBtn').classList.toggle('hidden',me.user.role==='report_viewer');
 $('transferCreate').classList.toggle('hidden',me.user.role!=='branch_user');
 await refreshAll();
}

async function refreshAll(){
 try{
  const [b,r,t]=await Promise.all([api('branches'),api('requests'),api('transfers')]);
  state.branches=b.branches||[];
  state.requests=r.requests||[];
  state.transfers=t.transfers||[];

  if(state.user.role==='system_admin'||state.user.role==='report_viewer'){
   try{
    const d=await api('dashboard?period='+currentPeriod());
    state.dashboard=d;
    state.branches=d.branches||state.branches;
   }catch(e){state.dashboard=null}
  }else{state.dashboard=null}

  fillBranchSelects();
  renderDashboard();
  renderRequests();
  renderTransfers();

  if(state.user.role==='system_admin'){
   try{const u=await api('users');state.users=u.users||[]}catch{}
   renderUsers();
  }

  if(['system_admin','report_viewer'].includes(state.user.role)){
   try{const a=await api('audit');state.audit=a.logs||[]}catch{}
   renderAudit();
  }
 }catch(e){message(e.message,true)}
}

function fillBranchSelects(){
 const opts=state.branches.map(b=>`<option value="${b.id}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
 ['reqBranch','fromBranch','toBranch','userBranches'].forEach(id=>{
  const el=$(id);
  if(el)el.innerHTML=opts;
 });
}

function renderDashboard(){
 const branches=state.branches;
 const req=state.requests;
 const c=state.dashboard?.counts||{
  total:req.length,
  pending:req.filter(x=>x.status==='pending').length
 };

 $('branchCount').textContent=branches.length;
 $('quotaCount').textContent=branches.reduce((n,b)=>n+Number(b.quota??b.monthly_quota??3),0);
 $('requestCount').textContent=c.total??req.length;
 $('pendingCount').textContent=c.pending??req.filter(x=>x.status==='pending').length;
 $('periodLabel').textContent='الفترة: '+currentPeriod();

 const q=($('branchSearch').value||'').toLowerCase();

 $('branchRows').innerHTML=branches
  .filter(b=>(b.name+' '+b.code).toLowerCase().includes(q))
  .map(b=>{
   const quota=Number(b.quota??b.monthly_quota??3);
   const inc=Number(b.transferred_in||0);
   const out=Number(b.transferred_out||0);
   const used=Number(b.used||0);
   return `<tr>
    <td>${esc(b.code)}</td>
    <td>${esc(b.name)}</td>
    <td>${quota}</td>
    <td>${inc}</td>
    <td>${out}</td>
    <td>${used}</td>
    <td>${quota+inc-out-used}</td>
   </tr>`;
  }).join('')||'<tr><td colspan="7">لا توجد فروع متاحة لحسابك</td></tr>';
}

$('branchSearch').oninput=renderDashboard;
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

(async()=>{
 try{
  await api('me');
  await startApp();
 }catch{
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
 }
})();

if('serviceWorker'in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
