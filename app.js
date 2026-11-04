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
 if(state.user?.role!=='system_admin'&&p!=='requests'){p='requests';}
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
 if(me.user.must_change_password){$('passwordChangeModal')?.classList.remove('hidden');}
 const permissions=me.user.permissions||{};const can=(key)=>me.user.role==='system_admin'?(permissions[key]!==false):!!permissions[key];
 $('usersNav').classList.toggle('hidden',!can('users'));
 $('nav').querySelector('[data-page=dashboard]')?.classList.toggle('hidden',!can('dashboard'));
 $('dashboard').classList.toggle('hidden',!can('dashboard'));
 $('auditNav').classList.toggle('hidden',!can('audit'));
 $('reportsNav').classList.toggle('hidden',!can('reports'));
 $('settingsNav')?.classList.toggle('hidden',!can('branches'));
 $('nav').querySelectorAll('button').forEach(b=>{const key={dashboard:'dashboard',requests:'requests',transfers:'transfers',reports:'reports',users:'users',audit:'audit',settings:'branches'}[b.dataset.page];if(key)b.classList.toggle('hidden',!can(key));});
 $('newRequestBtn').classList.toggle('hidden',!can('create_request'));
 if(me.user.role==='branch_user'){document.querySelector('#requests .filters')?.classList.add('hidden');$('requestList')?.classList.add('hidden');$('newRequestBtn2')?.classList.add('hidden');}
 $('transferCreate').classList.toggle('hidden',!can('create_transfer'));
 await refreshAll();
 const firstPage=[...document.querySelectorAll('#nav button:not(.hidden)')][0]?.dataset.page||'requests';setPage(firstPage);
 if(me.user.role==='branch_user')$('requestModal')?.classList.remove('hidden');
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
  if(state.user.role==='system_admin'||state.user.permissions?.dashboard){if(state.user.permissions?.dashboard!==false)renderDashboard();if(state.user.permissions?.transfers!==false)renderTransfers();}if(state.user.role==='branch_user'||state.user.permissions?.requests)renderRequests();

  if(state.user.role==='system_admin'){
   try{const u=await api('users');state.users=u.users||[];state.recoveryRequests=u.recoveryRequests||[]}catch{}
   renderUsers();loadAdminBranches();renderRecoveryRequests();
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
 const usage={};req.forEach(r=>{const k=String(r.branch_id||r.branch_code||'');usage[k]=(usage[k]||0)+1;});
 const ranked=branches.map(b=>({...b,count:usage[String(b.id)]||usage[String(b.code)]||0})).filter(b=>b.count>0).sort((a,b)=>b.count-a.count).slice(0,8);
 const maxUsage=ranked[0]?.count||1;
 if($('branchRanking'))$('branchRanking').innerHTML=ranked.map((b,i)=>{const n=Math.round(b.count/maxUsage*100);return '<div class="health-line"><span>'+(i+1)+'. '+esc(b.name)+' ('+b.count+' طلب)</span><b>'+n+'%</b><div class="track"><i style="width:'+n+'%"></i></div></div>';}).join('')||'<p class="muted">لا توجد فروع لديها طلبات.</p>';
 if($('pendingBar'))$('pendingBar').style.width=(total?Math.round(pending/total*100):0)+'%';
 if($('rejectedBar'))$('rejectedBar').style.width=(total?Math.round(rejected/total*100):0)+'%';
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
$('fromBranch').addEventListener('change',updateTransferTargets);
$('loadReportsBtn').onclick=loadReports;
document.querySelectorAll('[data-report-open]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-report-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.reportPanel!==b.dataset.reportOpen));loadReports();}));
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
$('reason')?.addEventListener('change',()=>{const show=$('reason').value==='سبب آخر';$('otherReasonWrap')?.classList.toggle('hidden',!show);$('otherReason').required=show;});
$('statusFilter').onchange=renderRequests;

$('newRequestBtn').onclick=()=>{ $('requestModal').classList.remove('hidden'); };
$('newRequestBtn2').onclick=()=>{ $('requestModal').classList.remove('hidden'); };

$('closeModal').onclick=()=>{
 $('requestModal').classList.add('hidden');
};

$('requestForm').onsubmit=async e=>{
 e.preventDefault();
 const phone=$('customerPhone').value.trim(),nid=$('nationalId').value.trim();
 if(!/^0[0-9]{10}$/.test(phone)){message('رقم التليفون غير صحيح، يجب أن يبدأ بصفر ويتكون من 11 رقمًا',true);return;}
 if(!/^[0-9]{14}$/.test(nid)){message('راجع الرقم القومي، يجب إدخال 14 رقمًا',true);return;}
 if($('reason').value==='سبب آخر'&&!$('otherReason').value.trim()){message('من فضلك اكتب سبب الاستثناء الآخر',true);return;}
 try{
  const branchId=Number($('reqBranch').value);
  const result=await api('requests',{
   method:'POST',
   body:JSON.stringify({
    branchId,
    invoiceNumber:$('invoice').value.trim(),
    customerName:$('customer').value.trim(),
    customerPhone:$('customerPhone').value.trim(),
    nationalId:$('nationalId').value.trim(),
    itemCode:$('itemCode').value.trim(),
    itemName:$('itemName').value.trim(),
    otherReason:$('otherReason').value.trim(),
    amount:Number($('amount').value),
    reason:$('reason').value,
    details:$('details').value.trim(),
    period:currentPeriod()
   })
  });

  e.target.reset();
  if(state.user.role!=='branch_user')$('requestModal').classList.add('hidden');
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


$('forgotPasswordBtn')?.addEventListener('click',async()=>{const username=prompt('اكتب اسم المستخدم لطلب استعادة كلمة المرور:');if(!username)return;try{await api('password-recovery',{method:'POST',body:JSON.stringify({username})});message('إذا كان الحساب موجودًا، تم تسجيل طلب الاستعادة لمراجعة مدير النظام.');}catch(e){message(e.message,true);}});
$('passwordChangeForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('change-password',{method:'POST',body:JSON.stringify({password:$('newOwnPassword').value})});$('passwordChangeModal').classList.add('hidden');message('تم تغيير كلمة المرور بنجاح');await startApp();}catch(err){message(err.message,true);}});
async function loadAdminBranches(){try{const d=await api('admin/branches');$('adminBranchList').innerHTML=(d.branches||[]).map(b=>'<article class="item"><b>'+esc(b.code)+' - '+esc(b.name)+'</b><p>الحصة: '+b.monthly_quota+' • '+(b.is_active?'نشط':'موقوف')+'</p><div class="itemactions"><button data-edit-branch="'+b.id+'">تعديل</button><button data-toggle-branch="'+b.id+'">'+(b.is_active?'إيقاف':'تفعيل')+'</button></div></article>').join('');document.querySelectorAll('[data-edit-branch]').forEach(btn=>btn.onclick=async()=>{const b=d.branches.find(x=>String(x.id)===btn.dataset.editBranch);const code=prompt('كود الفرع',b.code);if(code===null)return;const name=prompt('اسم الفرع',b.name);if(name===null)return;const quota=prompt('الحصة الأساسية',b.monthly_quota);if(quota===null)return;try{await api('admin/branches/'+b.id,{method:'PATCH',body:JSON.stringify({code,name,monthlyQuota:Number(quota)})});await loadAdminBranches();await refreshAll();message('تم تحديث الفرع');}catch(e){message(e.message,true);}});document.querySelectorAll('[data-toggle-branch]').forEach(btn=>btn.onclick=async()=>{try{await api('admin/branches/'+btn.dataset.toggleBranch,{method:'PATCH',body:JSON.stringify({toggleActive:true})});await loadAdminBranches();await refreshAll();}catch(e){message(e.message,true);}});}catch(e){message(e.message,true);}}
$('branchForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('admin/branches',{method:'POST',body:JSON.stringify({code:$('branchCode').value.trim(),name:$('branchName').value.trim(),monthlyQuota:Number($('branchQuota').value)})});e.target.reset();message('تمت إضافة الفرع');await loadAdminBranches();await refreshAll();}catch(err){message(err.message,true);}});


function renderRecoveryRequests(){
 const box=$('recoveryRequestList');if(!box)return;
 box.innerHTML=(state.recoveryRequests||[]).map(r=>'<article class="item"><b>'+esc(r.username)+'</b><p>'+esc(r.requested_at)+'</p><button data-recovery="'+esc(r.id)+'">تعيين كلمة مرور مؤقتة</button></article>').join('')||'<p>لا توجد طلبات استعادة معلقة.</p>';
 document.querySelectorAll('[data-recovery]').forEach(b=>b.onclick=async()=>{const p=prompt('كلمة مرور مؤقتة (12 حرفًا على الأقل)');if(!p)return;try{await api('password-recovery/'+b.dataset.recovery,{method:'POST',body:JSON.stringify({decision:'approve',temporaryPassword:p})});message('تمت الموافقة وتعيين كلمة مرور مؤقتة');await refreshAll();}catch(e){message(e.message,true);}});
}

function renderUsers(){
 $('userList').innerHTML=state.users.map(u=>`
  <article class="item">
   <div class="itemtop">
    <h3>${esc(u.display_name)}</h3>
    <span class="pill">${roleName(u.role)}</span>
   </div>
   <p>${esc(u.username)} • ${u.is_active?'نشط':'موقوف'}</p><div class="itemactions">${u.username.toLowerCase()==='admin'?'<b>حساب محمي - لا يمكن تعديله</b>':`<button data-user-edit="${esc(u.id)}">تعديل البيانات والصلاحيات</button><button data-user-toggle="${esc(u.id)}">${u.is_active?'إيقاف':'تفعيل'}</button><button data-user-reset="${esc(u.id)}">تعيين كلمة مرور مؤقتة</button>`}</div>
  </article>
 `).join('')||'<div class="item">لا يوجد مستخدمون آخرون.</div>';document.querySelectorAll('[data-user-edit]').forEach(b=>b.onclick=async()=>{const u=state.users.find(x=>String(x.id)===b.dataset.userEdit);if(!u)return;const displayName=prompt('الاسم الظاهر',u.display_name);if(displayName===null)return;const role=prompt('الدور: branch_user أو report_viewer أو system_admin',u.role);if(role===null)return;const branches=await api('branches');const selected=(await api('user-branches/'+encodeURIComponent(u.id))).branchIds||[];const choices=branches.branches.map(x=>x.id+': '+x.name).join('\\n');const raw=prompt('اكتب أرقام IDs للفروع مفصولة بفواصل. الفروع المتاحة:\\n'+choices,selected.join(','));if(raw===null)return;const current=u.permissions||{};const allowed=prompt('الصلاحيات المتاحة (اكتب أسماء الصلاحيات مفصولة بفواصل):\\ndashboard = لوحة المتابعة\nrequests = عرض طلبات الاستثناء\ncreate_request = إنشاء طلب استثناء\ntransfers = تحويل الحصص\ncreate_transfer = إنشاء تحويل حصة\nreports = التقارير\nusers = إدارة المستخدمين\nbranches = إدارة الفروع\naudit = سجل التدقيق\\nلإلغاء صلاحية احذفها من القائمة.',Object.keys(current).filter(k=>current[k]).join(','));if(allowed===null)return;const permissions={};allowed.split(',').map(x=>x.trim()).filter(Boolean).forEach(k=>{if(["dashboard","requests","create_request","transfers","create_transfer","reports","users","branches","audit"].includes(k))permissions[k]=true;});try{await api('users/'+encodeURIComponent(u.id),{method:'PATCH',body:JSON.stringify({displayName,role,branchIds:raw.split(',').map(x=>Number(x.trim())).filter(Number.isInteger),permissions})});message('تم تحديث المستخدم وصلاحيات فروعه');await refreshAll();}catch(e){message(e.message,true);}});
document.querySelectorAll('[data-user-toggle]').forEach(b=>b.onclick=async()=>{try{await api('users/'+b.dataset.userToggle,{method:'PATCH',body:JSON.stringify({toggleActive:true})});await refreshAll();}catch(e){message(e.message,true);}});document.querySelectorAll('[data-user-reset]').forEach(b=>b.onclick=async()=>{const p=prompt('أدخل كلمة مرور مؤقتة لا تقل عن 12 حرفًا:');if(!p)return;try{await api('users/'+b.dataset.userReset,{method:'PATCH',body:JSON.stringify({resetPassword:true,temporaryPassword:p})});message('تم تعيين كلمة المرور المؤقتة وسيُطلب من المستخدم تغييرها عند الدخول.');}catch(e){message(e.message,true);}});
}

async function loadReports(){
 const period=$('reportPeriod').value||currentPeriod();
 $('reportPeriod').value=period;
 try{
  const d=await api('reports?period='+encodeURIComponent(period));
  const statusLabel=s=>({pending:'معلق',approved:'معتمد',rejected:'مرفوض'}[s]||s);
  $('balanceReportRows').innerHTML=(d.balances||[]).map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${x.quota}</td><td>${x.transferred_in}</td><td>${x.transferred_out}</td><td>${x.used}</td><td>${x.available}</td></tr>`).join('')||'<tr><td colspan="7">لا توجد بيانات</td></tr>';
  $('requestReportRows').innerHTML=(d.requests||[]).map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.period)}</td><td>${esc(x.branch_code)}</td><td>${esc(x.branch_name)}</td><td>${esc(x.invoice_number)}</td><td>${esc(x.customer_name)}</td><td>${esc(x.customer_phone)}</td><td>${esc(x.national_id)}</td><td>${esc(x.item_code)}</td><td>${esc(x.item_name)}</td><td>${money(x.amount)}</td><td>${esc(x.reason==='سبب آخر'?(x.other_reason||x.reason):x.reason)}</td><td>${statusLabel(x.status)}</td><td>${esc(x.creator_name)}</td><td>${esc(x.decision_maker)}</td><td>${esc(x.created_at)}</td><td>${esc(x.decision_note)}</td></tr>`).join('')||'<tr><td colspan="13">لا توجد طلبات في الفترة المحددة</td></tr>';
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

async function refreshHeaderClock(){
 const now=new Date();
 const el=document.getElementById('liveClock'),date=document.getElementById('liveDate');
 if(el)el.textContent=new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(now);
 if(date)date.textContent=new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(now)+' • '+new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{timeZone:'Africa/Cairo',year:'numeric',month:'long',day:'numeric'}).format(now);
}
let prayerCoords={lat:30.0444,lon:31.2357},prayerCity='القاهرة',prayerSchedule=null;
function setPrayerHeading(){const h=document.querySelector('.prayer-heading b');if(h)h.textContent='مواقيت الصلاة - '+prayerCity;}
async function loadPrayerSchedule(){
 try{
  const r=await fetch('https://api.aladhan.com/v1/timings/'+Math.floor(Date.now()/1000)+'?latitude='+prayerCoords.lat+'&longitude='+prayerCoords.lon+'&method=5');
  if(!r.ok)throw new Error('prayer api');const j=await r.json();prayerSchedule=j.data.timings;
  const items=[['الفجر','Fajr'],['الشروق','Sunrise'],['الظهر','Dhuhr'],['العصر','Asr'],['المغرب','Maghrib'],['العشاء','Isha']];
  const list=document.getElementById('prayerTimes');if(list)list.innerHTML=items.map(([name,key])=>'<div class="prayer-time"><span>'+name+'</span><b dir="ltr">'+prayerSchedule[key].slice(0,5)+'</b></div>').join('');
  setPrayerHeading();updatePrayerCountdown();
 }catch{const box=document.getElementById('prayerLine');if(box)box.textContent='تعذر تحميل مواقيت الصلاة';}
}
function updatePrayerCountdown(){
 if(!prayerSchedule)return;const now=new Date(),keys=[['الفجر','Fajr'],['الشروق','Sunrise'],['الظهر','Dhuhr'],['العصر','Asr'],['المغرب','Maghrib'],['العشاء','Isha']];
 let next=null;for(const [name,key] of keys){const [h,m]=prayerSchedule[key].split(':').map(Number);const target=new Date(now);target.setHours(h,m,0,0);if(target>now){next={name,target};break;}}
 if(!next){const [h,m]=prayerSchedule.Fajr.split(':').map(Number),target=new Date(now);target.setDate(target.getDate()+1);target.setHours(h,m,0,0);next={name:'الفجر',target};}
 const sec=Math.max(0,Math.floor((next.target-now)/1000)),hh=String(Math.floor(sec/3600)).padStart(2,'0'),mm=String(Math.floor(sec%3600/60)).padStart(2,'0'),ss=String(sec%60).padStart(2,'0');
 const box=document.getElementById('prayerLine');if(box)box.textContent='الصلاة القادمة: '+next.name+' بعد '+hh+':'+mm+':'+ss;
}
function detectPrayerLocation(){
 if(!navigator.geolocation){loadPrayerSchedule();return;}
 navigator.geolocation.getCurrentPosition(async pos=>{
  prayerCoords={lat:pos.coords.latitude,lon:pos.coords.longitude};
  try{const r=await fetch('https://geocoding-api.open-meteo.com/v1/reverse?latitude='+prayerCoords.lat+'&longitude='+prayerCoords.lon+'&language=ar&format=json');const j=await r.json();prayerCity=j?.results?.[0]?.city||j?.results?.[0]?.name||j?.results?.[0]?.admin1||'موقعك الحالي';}catch{prayerCity='موقعك الحالي';}
  loadPrayerSchedule();
 },()=>{prayerCity='القاهرة (الموقع الافتراضي)';loadPrayerSchedule();},{enableHighAccuracy:false,timeout:10000,maximumAge:3600000});
}
detectPrayerLocation();setInterval(updatePrayerCountdown,1000);setInterval(loadPrayerSchedule,6*60*60*1000);
refreshHeaderClock();setInterval(refreshHeaderClock,1000);refreshPrayerTimes();setInterval(refreshPrayerTimes,6*60*60*1000);
