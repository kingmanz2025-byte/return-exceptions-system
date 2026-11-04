const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const fail=(message,status=400)=>json({ok:false,error:message},status);
const enc=new TextEncoder();
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
async function sha(s){return hex(await crypto.subtle.digest("SHA-256",enc.encode(s)));}

// تم ضبط PBKDF2 على الحد الأقصى المدعوم في Cloudflare Workers
async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey(
  "raw",
  enc.encode(password),
  "PBKDF2",
  false,
  ["deriveBits"]
 );
 return hex(await crypto.subtle.deriveBits({
  name:"PBKDF2",
  salt:enc.encode(salt),
  iterations:100000,
  hash:"SHA-256"
 },key,256));
}

const uid=()=>crypto.randomUUID();
const period=()=>new Date().toISOString().slice(0,7);
async function body(req){try{return await req.json()}catch{return null}}

function cookie(req){
 return (req.headers.get("Cookie")||"")
  .split(";")
  .map(x=>x.trim())
  .find(x=>x.startsWith("raneen_session="))
  ?.slice(15)||"";
}

async function auth(req,env){
 const token=cookie(req);
 if(!token)return null;

 const h=await sha(token);

 const s=await env.DB.prepare(
  "SELECT u.id,u.username,u.display_name,u.role,u.is_active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1"
 ).bind(h,new Date().toISOString()).first();

 return s||null;
}

const setCookie=(token)=>
 `raneen_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=604800`;

async function audit(env,user,action,type,id,details={}){
 await env.DB.prepare(
  "INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)"
 ).bind(
  user?.id||null,
  action,
  type,
  id||null,
  JSON.stringify(details)
 ).run();
}

async function branchAccess(env,user,branchId){
 if(user.role==="system_admin")return true;

 return !!await env.DB.prepare(
  "SELECT 1 FROM user_branch_access WHERE user_id=? AND branch_id=?"
 ).bind(user.id,branchId).first();
}

async function ensureBalance(env,branchId,p){
 await env.DB.prepare(
  "INSERT OR IGNORE INTO monthly_branch_balances(branch_id,period,quota) SELECT id,?,monthly_quota FROM branches WHERE id=? AND is_active=1"
 ).bind(p,branchId).run();

 return env.DB.prepare(
  "SELECT * FROM monthly_branch_balances WHERE branch_id=? AND period=?"
 ).bind(branchId,p).first();
}

export async function onRequest({request,env}) {

 if(!env.DB)return fail("D1 binding DB is missing",503);

 const url=new URL(request.url);
 const path=url.pathname.replace(/^\/api\/?/,"").replace(/\/$/,"");
 const method=request.method;

 if(method==="OPTIONS")return new Response(null,{status:204});

 if(path==="health"&&method==="GET"){
  const r=await env.DB.prepare(
   "SELECT COUNT(*) total_branches FROM branches WHERE is_active=1"
  ).first();

  return json({ok:true,database:"connected",...r});
 }

 if(path==="setup-status"&&method==="GET"){
  const count=await env.DB.prepare(
   "SELECT COUNT(*) n FROM users"
  ).first();

  return json({
   ok:true,
   setupRequired:Number(count?.n||0)===0
  });
 }

 // إنشاء المدير الأول
 if(path==="setup"&&method==="POST"){
  let stage="start";

  try{
   stage="check_setup_key";

   if(!env.ADMIN_SETUP_KEY)
    return fail("Set ADMIN_SETUP_KEY in Cloudflare Pages environment variables first",503);

   const x=await body(request);

   if(!x||x.setupKey!==env.ADMIN_SETUP_KEY)
    return fail("Setup key is incorrect",403);

   stage="check_existing_users";

   const count=await env.DB.prepare(
    "SELECT COUNT(*) n FROM users"
   ).first();

   if(Number(count?.n||0)>0)
    return fail("Initial setup is already completed",409);

   stage="validate_input";

   if(
    !/^[a-zA-Z0-9_.-]{4,40}$/.test(x.username||"")||
    typeof x.password!=="string"||
    x.password.length<12||
    !x.displayName
   ){
    return fail("Enter username, display name and a password of at least 12 characters");
   }

   stage="generate_credentials";

   const id=uid();
   const salt=b64u(crypto.getRandomValues(new Uint8Array(16)));

   stage="password_hash";

   const hash=await passwordHash(x.password,salt);

   stage="insert_user";

   await env.DB.prepare(
    "INSERT INTO users(id,username,display_name,password_hash,password_salt,role) VALUES(?,?,?,?,?,'system_admin')"
   ).bind(
    id,
    x.username,
    x.displayName,
    hash,
    salt
   ).run();

   stage="audit_log";

   await audit(
    env,
    {id},
    "initial_admin_created",
    "user",
    id,
    {username:x.username}
   );

   return json({
    ok:true,
    message:"Initial administrator created"
   });

  }catch(error){
   console.error("INITIAL_SETUP_FAILED",stage,error);

   return json({
    ok:false,
    error:"Setup failed",
    stage
   },500);
  }
 }

 // تسجيل الدخول
 if(path==="login"&&method==="POST"){
  const x=await body(request);

  if(!x?.username||!x?.password)
   return fail("Username and password are required");

  const u=await env.DB.prepare(
   "SELECT * FROM users WHERE username=? COLLATE NOCASE AND is_active=1"
  ).bind(x.username.trim()).first();

  if(!u||await passwordHash(x.password,u.password_salt)!==u.password_hash)
   return fail("اسم المستخدم أو كلمة المرور غير صحيحة",401);

  const token=b64u(crypto.getRandomValues(new Uint8Array(32)));
  const id=uid();
  const expires=new Date(Date.now()+7*86400000).toISOString();

  await env.DB.prepare(
   "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)"
  ).bind(
   id,
   u.id,
   await sha(token),
   expires
  ).run();

  return new Response(JSON.stringify({
   ok:true,
   user:{
    id:u.id,
    username:u.username,
    displayName:u.display_name,
    role:u.role
   }
  }),{
   headers:{
    "content-type":"application/json",
    "set-cookie":setCookie(token),
    "cache-control":"no-store"
   }
  });
 }

 const user=await auth(request,env);

 // تسجيل الخروج
 if(path==="logout"&&method==="POST"){
  const t=cookie(request);

  if(t){
   await env.DB.prepare(
    "DELETE FROM sessions WHERE token_hash=?"
   ).bind(await sha(t)).run();
  }

  return new Response(JSON.stringify({ok:true}),{
   headers:{
    "content-type":"application/json",
    "set-cookie":"raneen_session=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0",
    "cache-control":"no-store"
   }
  });
 }

 if(!user)return fail("يلزم تسجيل الدخول",401);

 // بيانات المستخدم الحالي
 if(path==="me"&&method==="GET"){
  const access=await env.DB.prepare(
   "SELECT b.id,b.code,b.name FROM user_branch_access a JOIN branches b ON b.id=a.branch_id WHERE a.user_id=? AND b.is_active=1 ORDER BY b.id"
  ).bind(user.id).all();

  return json({
   ok:true,
   user,
   branches:access.results
  });
 }

 // قائمة الفروع النشطة لاختيار الفرع المستفيد في طلب تحويل الحصة
 if(path==="transfer-branches"&&method==="GET"){
  if(!["branch_user","system_admin"].includes(user.role))return fail("ليس لديك صلاحية عرض الفروع للتحويل",403);
  const rows=await env.DB.prepare("SELECT id,code,name,monthly_quota FROM branches WHERE is_active=1 ORDER BY id").all();
  return json({ok:true,branches:rows.results});
 }

 // الفروع
 if(path==="branches"&&method==="GET"){
  const rows=user.role==="system_admin"
   ?await env.DB.prepare(
     "SELECT id,code,name,monthly_quota FROM branches WHERE is_active=1 ORDER BY id"
    ).all()
   :await env.DB.prepare(
     "SELECT b.id,b.code,b.name,b.monthly_quota FROM user_branch_access a JOIN branches b ON b.id=a.branch_id WHERE a.user_id=? AND b.is_active=1 ORDER BY b.id"
    ).bind(user.id).all();

  return json({ok:true,branches:rows.results});
 }

 // عرض الطلبات
 if(path==="requests"&&method==="GET"){
  let sql=
   "SELECT e.*,b.code branch_code,b.name branch_name,u.display_name creator_name FROM exception_requests e JOIN branches b ON b.id=e.branch_id JOIN users u ON u.id=e.created_by";

  let rows=user.role==="system_admin"||user.role==="report_viewer"
   ?await env.DB.prepare(
     sql+" ORDER BY e.created_at DESC LIMIT 500"
    ).all()
   :await env.DB.prepare(
     sql+" JOIN user_branch_access a ON a.branch_id=e.branch_id AND a.user_id=? ORDER BY e.created_at DESC LIMIT 500"
    ).bind(user.id).all();

  return json({ok:true,requests:rows.results});
 }

 // إنشاء طلب استثناء
 if(path==="requests"&&method==="POST"){
  if(user.role==="report_viewer")
   return fail("ليس لديك صلاحية إنشاء الطلبات",403);

  const x=await body(request);
  const branchId=Number(x?.branchId);
  const p=x?.period||period();

  if(!Number.isInteger(branchId)||!await branchAccess(env,user,branchId))
   return fail("الفرع غير مصرح به",403);

  if(
   !x.invoiceNumber||
   !x.reason||
   !x.details||
   !Number.isFinite(Number(x.amount))||
   Number(x.amount)<0
  ){
   return fail("أكمل بيانات الطلب المطلوبة");
  }

  await ensureBalance(env,branchId,p);

  const bal=await env.DB.prepare(
   "SELECT quota+transferred_in-transferred_out-used available FROM monthly_branch_balances WHERE branch_id=? AND period=?"
  ).bind(branchId,p).first();

  const id="REQ-"+uid();

  await env.DB.prepare(
   "INSERT INTO exception_requests(id,branch_id,created_by,invoice_number,customer_name,amount,reason,details,attachment_key,status,period,is_over_quota) VALUES(?,?,?,?,?,?,?, ?,?,'pending',?,?)"
  ).bind(
   id,
   branchId,
   user.id,
   x.invoiceNumber.trim(),
   x.customerName||null,
   Number(x.amount),
   x.reason,
   x.details,
   x.attachmentKey||null,
   p,
   bal.available<=0?1:0
  ).run();

  await audit(env,user,"request_created","exception_request",id,{
   branchId,
   period:p
  });

  return json({
   ok:true,
   id,
   status:"pending",
   available:bal.available
  },201);
 }

 // عرض التحويلات
 if(path==="transfers"&&method==="GET"){
  const rows=await env.DB.prepare(
   "SELECT t.*,f.name from_branch_name, d.name to_branch_name, u.display_name requester_name, dec.display_name decided_by_name FROM quota_transfer_requests t JOIN branches f ON f.id=t.from_branch_id JOIN branches d ON d.id=t.to_branch_id LEFT JOIN users u ON u.id=t.requested_by LEFT JOIN users dec ON dec.id=t.decided_by ORDER BY t.created_at DESC LIMIT 300"
  ).all();

  return json({ok:true,transfers:rows.results});
 }

 // إنشاء طلب تحويل حصة
 if(path==="transfers"&&method==="POST"){
  if(!["branch_user","system_admin"].includes(user.role))
   return fail("ليس لديك صلاحية إنشاء طلب تحويل",403);

  const x=await body(request);
  const from=Number(x?.fromBranchId);
  const to=Number(x?.toBranchId);
  const n=Number(x?.quantity);
  const p=x?.period||period();

  if(
   !await branchAccess(env,user,from)||
   !Number.isInteger(to)||
   from===to||
   !Number.isInteger(n)||
   n<1||
   !x.reason
  ){
   return fail("بيانات التحويل غير صحيحة أو الفرع غير مصرح به");
  }

  const target=await env.DB.prepare("SELECT id FROM branches WHERE id=? AND is_active=1").bind(to).first();
  if(!target)return fail("الفرع المستفيد غير موجود أو غير نشط");

  await ensureBalance(env,from,p);
  await ensureBalance(env,to,p);

  const id="TR-"+uid();

  await env.DB.prepare(
   "INSERT INTO quota_transfer_requests(id,from_branch_id,to_branch_id,period,quantity,reason,requested_by) VALUES(?,?,?,?,?,?,?)"
  ).bind(
   id,
   from,
   to,
   p,
   n,
   x.reason,
   user.id
  ).run();

  await audit(env,user,"transfer_requested","quota_transfer",id,{
   from,
   to,
   quantity:n,
   period:p
  });

  return json({ok:true,id,status:"pending"},201);
 }

 // اعتماد أو رفض التحويل
 if(path.startsWith("transfers/")&&method==="POST"){
  if(user.role!=="system_admin")
   return fail("اعتماد أو رفض التحويل لمدير النظام فقط",403);

  const id=path.split("/")[1];
  const x=await body(request);

  const t=await env.DB.prepare(
   "SELECT * FROM quota_transfer_requests WHERE id=?"
  ).bind(id).first();

  if(!t||t.status!=="pending")
   return fail("طلب التحويل غير موجود أو تم اتخاذ قرار بشأنه",404);

  if(x?.decision==="approve"){
   await ensureBalance(env,t.from_branch_id,t.period);
   await ensureBalance(env,t.to_branch_id,t.period);

   const a=await env.DB.prepare(
    "SELECT quota+transferred_in-transferred_out-used available FROM monthly_branch_balances WHERE branch_id=? AND period=?"
   ).bind(t.from_branch_id,t.period).first();

   if(a.available<t.quantity)
    return fail("رصيد الفرع المانح غير كافٍ");

   await env.DB.batch([
    env.DB.prepare(
     "UPDATE monthly_branch_balances SET transferred_out=transferred_out+? WHERE branch_id=? AND period=? AND quota+transferred_in-transferred_out-used>=?"
    ).bind(t.quantity,t.from_branch_id,t.period,t.quantity),

    env.DB.prepare(
     "UPDATE monthly_branch_balances SET transferred_in=transferred_in+? WHERE branch_id=? AND period=?"
    ).bind(t.quantity,t.to_branch_id,t.period),

    env.DB.prepare(
     "UPDATE quota_transfer_requests SET status='approved',decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
    ).bind(user.id,x.note||null,id)
   ]);

  }else if(x?.decision==="reject"){
   await env.DB.prepare(
    "UPDATE quota_transfer_requests SET status='rejected',decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
   ).bind(user.id,x.note||null,id).run();

  }else{
   return fail("Decision must be approve or reject");
  }

  await audit(env,user,"transfer_"+x.decision,"quota_transfer",id,{
   note:x.note||""
  });

  return json({ok:true});
 }

 // اعتماد أو رفض طلب استثناء
 if(path==="decisions"&&method==="POST"){
  if(user.role!=="system_admin")
   return fail("القرار لمدير النظام فقط",403);

  const x=await body(request);

  const r=await env.DB.prepare(
   "SELECT * FROM exception_requests WHERE id=?"
  ).bind(x?.id).first();

  if(!r||r.status!=="pending")
   return fail("الطلب غير موجود أو تم البت فيه",404);

  if(!["approve","reject"].includes(x.decision))
   return fail("قرار غير صحيح");

  if(x.decision==="approve"){
   await ensureBalance(env,r.branch_id,r.period);

   const bal=await env.DB.prepare(
    "SELECT quota+transferred_in-transferred_out-used available FROM monthly_branch_balances WHERE branch_id=? AND period=?"
   ).bind(r.branch_id,r.period).first();

   if(bal.available<=0&&!x.note)
    return fail("الموافقة فوق الحصة تتطلب مبررًا مكتوبًا");

   if(bal.available>0){
    await env.DB.prepare(
     "UPDATE monthly_branch_balances SET used=used+1 WHERE branch_id=? AND period=? AND quota+transferred_in-transferred_out-used>0"
    ).bind(r.branch_id,r.period).run();
   }
  }

  await env.DB.prepare(
   "UPDATE exception_requests SET status=?,decision_note=?,decided_by=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
  ).bind(
   x.decision==="approve"?"approved":"rejected",
   x.note||null,
   user.id,
   r.id
  ).run();

  await audit(env,user,"request_"+x.decision,"exception_request",r.id,{
   note:x.note||""
  });

  return json({ok:true});
 }

 // عرض المستخدمين
 if(path==="users"&&method==="GET"){
  if(user.role!=="system_admin")
   return fail("صلاحية مدير النظام مطلوبة",403);

  const rows=await env.DB.prepare(
   "SELECT id,username,display_name,role,is_active,created_at FROM users ORDER BY created_at DESC"
  ).all();

  return json({ok:true,users:rows.results});
 }

 // إنشاء مستخدم
 if(path==="users"&&method==="POST"){
  if(user.role!=="system_admin")
   return fail("صلاحية مدير النظام مطلوبة",403);

  const x=await body(request);

  if(
   !x.username||
   !x.displayName||
   !["branch_user","report_viewer","system_admin"].includes(x.role)||
   typeof x.password!=="string"||
   x.password.length<12
  ){
   return fail("بيانات المستخدم غير مكتملة أو كلمة المرور أقل من 12 حرفًا");
  }

  const id=uid();
  const salt=b64u(crypto.getRandomValues(new Uint8Array(16)));
  const hash=await passwordHash(x.password,salt);

  try{
   await env.DB.prepare(
    "INSERT INTO users(id,username,display_name,password_hash,password_salt,role,created_by) VALUES(?,?,?,?,?,?,?)"
   ).bind(
    id,
    x.username,
    x.displayName,
    hash,
    salt,
    x.role,
    user.id
   ).run();

   for(const bid of (x.branchIds||[])){
    await env.DB.prepare(
     "INSERT INTO user_branch_access(user_id,branch_id) VALUES(?,?)"
    ).bind(id,Number(bid)).run();
   }

  }catch{
   return fail("تعذر إنشاء المستخدم؛ تحقق من عدم تكرار اسم المستخدم وصحة الفروع");
  }

  await audit(env,user,"user_created","user",id,{
   username:x.username,
   role:x.role
  });

  return json({ok:true,id},201);
 }

 // لوحة المعلومات
 if(path==="dashboard"&&method==="GET"){
  const p=url.searchParams.get("period")||period();

  const branches=await env.DB.prepare(
   "SELECT b.id,b.code,b.name,COALESCE(m.quota,b.monthly_quota) quota,COALESCE(m.transferred_in,0) transferred_in,COALESCE(m.transferred_out,0) transferred_out,COALESCE(m.used,0) used FROM branches b LEFT JOIN monthly_branch_balances m ON m.branch_id=b.id AND m.period=? WHERE b.is_active=1 ORDER BY b.id"
  ).bind(p).all();

  const counts=await env.DB.prepare(
   "SELECT COUNT(*) total,SUM(status='pending') pending,SUM(status='approved') approved,SUM(status='rejected') rejected FROM exception_requests WHERE period=?"
  ).bind(p).first();

  return json({
   ok:true,
   period:p,
   branches:branches.results,
   counts
  });
 }

 // التقارير الشاملة
 if(path==="reports"&&method==="GET"){
  if(!["system_admin","report_viewer"].includes(user.role))return fail("ليس لديك صلاحية عرض التقارير",403);
  const p=url.searchParams.get("period")||period();
  if(!/^\\d{4}-\\d{2}$/.test(p))return fail("صيغة الفترة غير صحيحة");
  const requests=await env.DB.prepare(
   "SELECT e.id,e.period,e.invoice_number,e.customer_name,e.amount,e.reason,e.details,e.status,e.decision_note,e.created_at,b.code branch_code,b.name branch_name,cu.display_name creator_name,du.display_name decision_maker FROM exception_requests e JOIN branches b ON b.id=e.branch_id LEFT JOIN users cu ON cu.id=e.created_by LEFT JOIN users du ON du.id=e.decided_by WHERE e.period=? ORDER BY b.id,e.created_at DESC"
  ).bind(p).all();
  const transfers=await env.DB.prepare(
   "SELECT t.id,t.period,t.quantity,t.reason,t.status,t.created_at,t.decided_at,t.decision_note,f.code from_code,f.name from_name,d.code to_code,d.name to_name,ru.display_name requester_name,du.display_name decision_maker FROM quota_transfer_requests t JOIN branches f ON f.id=t.from_branch_id JOIN branches d ON d.id=t.to_branch_id LEFT JOIN users ru ON ru.id=t.requested_by LEFT JOIN users du ON du.id=t.decided_by WHERE t.period=? ORDER BY f.id,d.id,t.created_at DESC"
  ).bind(p).all();
  const balances=await env.DB.prepare(
   "SELECT b.code,b.name,COALESCE(m.quota,b.monthly_quota) quota,COALESCE(m.transferred_in,0) transferred_in,COALESCE(m.transferred_out,0) transferred_out,COALESCE(m.used,0) used,COALESCE(m.quota,b.monthly_quota)+COALESCE(m.transferred_in,0)-COALESCE(m.transferred_out,0)-COALESCE(m.used,0) available FROM branches b LEFT JOIN monthly_branch_balances m ON m.branch_id=b.id AND m.period=? WHERE b.is_active=1 ORDER BY b.id"
  ).bind(p).all();
  return json({ok:true,period:p,requests:requests.results,transfers:transfers.results,balances:balances.results});
 }

 // سجل المراجعة
 if(path==="audit"&&method==="GET"){
  if(user.role!=="system_admin"&&user.role!=="report_viewer")
   return fail("غير مصرح",403);

  const r=await env.DB.prepare(
   "SELECT a.*,u.display_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 500"
  ).all();

  return json({ok:true,logs:r.results});
 }

 return fail("API route not found",404);
}
