# نظام استثناءات المرتجعات — حزمة ربط Cloudflare D1

هذه الحزمة تضيف طبقة API على Cloudflare Pages Functions متوافقة مع الجداول الموجودة في `return-exceptions-db`. تم الحفاظ على ملفات الواجهة الحالية دون تغيير شكلها.

## مهم قبل التشغيل
- ملفات الواجهة الحالية (`app.js`) ما زالت نسخة العرض التجريبية التي تستخدم `localStorage`. إضافة API وحدها لا تعني أن الواجهة أصبحت متصلة به. لا تستخدم النظام ببيانات تشغيلية قبل استكمال توصيل الواجهة واختبار الصلاحيات.
- لا تحذف قاعدة D1 ولا تعِد إنشاء الجداول.
- تأكد من أن قاعدة `branches` تحتوي الفروع الرسمية الـ56 بأسمائها وأكوادها الصحيحة. هذه الحزمة لا تستبدل بيانات الفروع الموجودة.

## إضافة ملفات API إلى GitHub
1. فك ضغط الحزمة.
2. ارفع مجلد `functions` إلى جذر المستودع بجوار `index.html` و`app.js`.
3. ارفع ملف `README.md` المحدّث اختياريًا.
4. انتظر إعادة نشر Cloudflare Pages.

## إعداد Cloudflare Pages
في مشروع Pages `return-exceptions-system`:
1. Settings → Functions → D1 database bindings.
2. اربط قاعدة `return-exceptions-db` بالاسم `DB` (إن كان الربط موجودًا بالفعل فلا تغيّره).
3. Settings → Variables and Secrets → Production.
4. أضف متغيرًا سريًا اسمه `ADMIN_SETUP_KEY`، واجعل قيمته كلمة عشوائية طويلة لا تشاركها مع أحد.
5. أعد النشر بعد إضافة المتغير.

## إنشاء أول مدير نظام
بعد النشر، أرسل POST إلى `/api/setup` بجسم JSON:
```json
{
  "setupKey": "نفس قيمة ADMIN_SETUP_KEY",
  "username": "admin",
  "displayName": "مدير النظام",
  "password": "كلمة مرور قوية لا تقل عن 12 حرفًا"
}
```
يُسمح بإنشاء أول مدير فقط عندما يكون جدول users فارغًا. بعد النجاح احذف `ADMIN_SETUP_KEY` من إعدادات Pages وأعد النشر.

## نقاط API المتاحة
- `GET /api/health`
- `POST /api/setup` إنشاء أول مدير فقط
- `POST /api/login` تسجيل الدخول (جلسة Cookie آمنة)
- `GET /api/me`
- `POST /api/logout`
- `GET /api/branches`
- `GET, POST /api/requests`
- `POST /api/decisions` قرار مدير النظام على طلب الاستثناء
- `GET, POST /api/transfers`
- `POST /api/transfers/{id}` قرار مدير النظام على طلب التحويل
- `GET, POST /api/users` إدارة المستخدمين لمدير النظام
- `GET /api/dashboard`
- `GET /api/audit`

## الأدوار
- `system_admin`: إدارة المستخدمين، الاطلاع على كل الفروع، واعتماد/رفض الطلبات والتحويلات.
- `branch_user`: إنشاء الطلبات وطلب تحويل حصة من فرع مخوّل له.
- `report_viewer`: قراءة الطلبات والتقارير وسجل التدقيق.

## ملاحظات تقنية
- كلمات المرور تُشتق باستخدام PBKDF2-SHA256 مع salt عشوائي و210,000 تكرار.
- الجلسات تحفظ hash للرمز فقط، والـCookie من نوع HttpOnly/Secure/SameSite=Lax.
- يجب إجراء اختبار أمني واختبارات تزامن قبل الاستخدام الفعلي، خصوصًا عمليات اعتماد الطلبات وتحديث الأرصدة.
- المرفقات غير مفعّلة في هذه الحزمة.
