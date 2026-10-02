/* ============================================================
   i18n.js — textos de /support y /marketing en 6 idiomas
   ------------------------------------------------------------
   Cada elemento con data-i18n="clave" recibe el texto; con
   data-i18n-html se permite HTML (para el <em> de los títulos) y
   con data-i18n-aria se traduce su aria-label.
   El idioma se elige así: ?lang=xx  →  el último elegido (guardado)
   →  el idioma del navegador  →  español.
   ============================================================ */

import { CONFIG } from './config.js';

const LANGS = [
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];

const T = {
  /* ------------------------------------------------ ES */
  es: {
    'back': 'Volver al inicio',
    'lang': 'Idioma',
    'foot.rights': 'Todos los derechos reservados.',
    'foot.support': 'Soporte',
    'foot.marketing': 'Apps',
    'foot.home': 'Inicio',
    'foot.privacy': 'Privacidad',

    'p.meta': 'Políticas de privacidad — fukudamiyasato',
    'p.kicker': 'Privacidad',
    'p.title': 'Políticas de privacidad',
    'p.lead': 'Elige una app para ver su política de privacidad.',
    'p.general': 'General — todas las apps',

    's.meta': 'Soporte — fukudamiyasato',
    's.kicker': 'Soporte',
    's.title': '¿Cómo te podemos <em>ayudar</em>?',
    's.lead': 'Encuentra respuestas a las preguntas más comunes sobre nuestras apps para iOS y Android, o escríbenos directamente y te respondemos pronto.',
    's.c1.t': 'Contacto directo',
    's.c1.d': 'Escríbenos por correo. Respondemos en 24–48 horas hábiles.',
    's.c2.t': 'Preguntas frecuentes',
    's.c2.d': 'Compras, suscripciones, cuentas y problemas técnicos.',
    's.c3.t': 'Tus datos',
    's.c3.d': 'No vendemos tus datos. Pide acceso o eliminación cuando quieras.',
    's.faq': 'Preguntas frecuentes',
    's.q1': '¿Cómo contacto al soporte?',
    's.a1': 'Escríbenos al correo de esta página indicando el nombre de la app. Respondemos en un plazo de 24 a 48 horas hábiles.',
    's.q2': '¿Cómo solicito un reembolso?',
    's.a2': 'Los pagos se procesan a través de App Store o Google Play, por lo que los reembolsos los gestionan ellos. En iOS entra a reportaproblem.apple.com; en Android, abre Google Play › Pagos y suscripciones › Presupuesto e historial.',
    's.q3': '¿Cómo restauro mis compras?',
    's.a3': 'Abre la app, ve a Ajustes y toca «Restaurar compras». Asegúrate de usar el mismo Apple ID o cuenta de Google con el que hiciste la compra.',
    's.q4': '¿Cómo cancelo una suscripción?',
    's.a4': 'En iPhone: Ajustes › [tu nombre] › Suscripciones. En Android: Google Play › Perfil › Pagos y suscripciones › Suscripciones. Borrar la app no cancela la suscripción.',
    's.q5': '¿Cómo elimino mi cuenta y mis datos?',
    's.a5': 'Puedes hacerlo desde los ajustes de la app o escribiéndonos desde el correo asociado a tu cuenta. Eliminamos todos tus datos en un plazo máximo de 30 días.',
    's.q6': 'La app se cierra o no funciona bien',
    's.a6': 'Actualiza a la última versión, reinicia el dispositivo y, si sigue fallando, reinstala la app. Si el problema continúa, escríbenos con el modelo del dispositivo, la versión del sistema, la versión de la app y los pasos para reproducirlo.',
    's.q7': '¿Qué dispositivos son compatibles?',
    's.a7': 'En general, iPhone y iPad con iOS 16 o superior y teléfonos Android 8.0 o superior. Revisa la ficha de cada app en la tienda para ver los requisitos exactos.',
    's.contact.t': '¿Sigues necesitando ayuda?',
    's.contact.d': 'Para resolverlo más rápido, incluye en tu mensaje:',
    's.contact.l1': 'Nombre de la app y versión',
    's.contact.l2': 'Modelo del dispositivo y versión de iOS / Android',
    's.contact.l3': 'Qué pasó y cómo reproducirlo (capturas ayudan)',
    's.contact.btn': 'Escribir al soporte',
    's.contact.time': 'Respuesta en 24–48 h hábiles',

    'm.meta': 'Apps — fukudamiyasato',
    'm.kicker': 'Apps para iOS y Android',
    'm.title': 'Apps simples, rápidas y <em>bien hechas</em>.',
    'm.lead': 'Diseñamos y desarrollamos aplicaciones que resuelven una cosa y la resuelven bien: interfaces claras, sin ruido y pensadas para tu día a día.',
    'm.ios.s': 'Descárgalo en',
    'm.android.s': 'Disponible en',
    'm.feat': 'Por qué nuestras apps',
    'm.f1.t': 'Rápidas', 'm.f1.d': 'Abren al instante y responden a cada toque, incluso en dispositivos antiguos.',
    'm.f2.t': 'Privadas', 'm.f2.d': 'Pedimos solo los datos necesarios y nunca los vendemos a terceros.',
    'm.f3.t': 'Diseño cuidado', 'm.f3.d': 'Interfaces limpias, modo oscuro y detalles que se sienten nativos.',
    'm.f4.t': 'Sin conexión', 'm.f4.d': 'Las funciones clave siguen disponibles aunque no tengas internet.',
    'm.f5.t': 'Multilenguaje', 'm.f5.d': 'Disponibles en español, inglés, japonés, italiano, francés y alemán.',
    'm.f6.t': 'Soporte real', 'm.f6.d': 'Personas reales responden tus dudas en menos de 48 horas.',
    'm.steps': 'Empieza en tres pasos',
    'm.s1.t': 'Descarga', 'm.s1.d': 'Búscala en App Store o Google Play e instálala gratis.',
    'm.s2.t': 'Configura', 'm.s2.d': 'Elige tus preferencias en menos de un minuto, sin formularios largos.',
    'm.s3.t': 'Úsala', 'm.s3.d': 'Listo. Todo lo importante a un toque de distancia.',
    'm.cta.t': '¿Listo para probarla?',
    'm.cta.d': 'Descárgala gratis y cuéntanos qué te parece. Tus comentarios hacen mejor cada versión.',
    'm.press.t': 'Prensa y colaboraciones',
    'm.press.d': 'Para prensa, alianzas o kit de medios (logos, capturas e íconos), escríbenos y te enviamos todo lo que necesites.',
    'm.press.btn': 'Contactar',
  },

  /* ------------------------------------------------ JA */
  ja: {
    'back': 'ホームに戻る',
    'lang': '言語',
    'foot.rights': 'All rights reserved.',
    'foot.support': 'サポート',
    'foot.marketing': 'アプリ',
    'foot.home': 'ホーム',
    'foot.privacy': 'プライバシー',

    'p.meta': 'プライバシーポリシー — fukudamiyasato',
    'p.kicker': 'プライバシー',
    'p.title': 'プライバシーポリシー',
    'p.lead': 'アプリを選んでプライバシーポリシーをご覧ください。',
    'p.general': '共通 — すべてのアプリ',

    's.meta': 'サポート — fukudamiyasato',
    's.kicker': 'サポート',
    's.title': 'どのような<em>お手伝い</em>が必要ですか？',
    's.lead': 'iOS・Android アプリに関するよくある質問への回答をご覧いただくか、直接メールでお問い合わせください。すぐにご返信いたします。',
    's.c1.t': 'お問い合わせ',
    's.c1.d': 'メールでご連絡ください。24〜48 営業時間以内にご返信します。',
    's.c2.t': 'よくある質問',
    's.c2.d': '購入、サブスクリプション、アカウント、技術的な問題について。',
    's.c3.t': 'データについて',
    's.c3.d': 'データを販売することはありません。いつでも開示・削除をご依頼いただけます。',
    's.faq': 'よくある質問',
    's.q1': 'サポートへの連絡方法は？',
    's.a1': 'このページのメールアドレス宛に、アプリ名を添えてご連絡ください。24〜48 営業時間以内にご返信します。',
    's.q2': '返金を依頼するには？',
    's.a2': 'お支払いは App Store または Google Play を通じて処理されるため、返金は各ストアが対応します。iOS の場合は reportaproblem.apple.com、Android の場合は Google Play › お支払いと定期購入 › 予算と履歴 からご依頼ください。',
    's.q3': '購入を復元するには？',
    's.a3': 'アプリを開き、設定から「購入を復元」をタップしてください。購入時と同じ Apple ID または Google アカウントをご使用ください。',
    's.q4': 'サブスクリプションを解約するには？',
    's.a4': 'iPhone：設定 › [ユーザー名] › サブスクリプション。Android：Google Play › プロフィール › お支払いと定期購入 › 定期購入。アプリを削除しても解約にはなりません。',
    's.q5': 'アカウントとデータを削除するには？',
    's.a5': 'アプリの設定から、またはアカウントに登録したメールアドレスからご連絡いただくことで削除できます。すべてのデータは 30 日以内に削除されます。',
    's.q6': 'アプリが落ちる・正しく動かない',
    's.a6': '最新バージョンに更新し、端末を再起動してください。それでも改善しない場合はアプリを再インストールしてください。問題が続く場合は、端末の機種、OS バージョン、アプリのバージョン、再現手順を添えてご連絡ください。',
    's.q7': '対応している端末は？',
    's.a7': '基本的に iOS 16 以降の iPhone・iPad、Android 8.0 以降のスマートフォンに対応しています。正確な動作環境は各アプリのストアページをご確認ください。',
    's.contact.t': 'まだお困りですか？',
    's.contact.d': 'スムーズに解決するため、以下をメッセージに含めてください：',
    's.contact.l1': 'アプリ名とバージョン',
    's.contact.l2': '端末の機種と iOS / Android のバージョン',
    's.contact.l3': '発生した内容と再現手順（スクリーンショットがあると助かります）',
    's.contact.btn': 'サポートに連絡',
    's.contact.time': '24〜48 営業時間以内に返信',

    'm.meta': 'アプリ — fukudamiyasato',
    'm.kicker': 'iOS・Android アプリ',
    'm.title': 'シンプルで、速く、<em>丁寧に作られた</em>アプリ。',
    'm.lead': 'ひとつのことを、しっかり解決するアプリを設計・開発しています。わかりやすく、余計なものがなく、毎日使いやすいインターフェースです。',
    'm.ios.s': 'ダウンロード',
    'm.android.s': '入手先',
    'm.feat': '私たちのアプリが選ばれる理由',
    'm.f1.t': '高速', 'm.f1.d': '古い端末でも一瞬で起動し、あらゆる操作にすばやく反応します。',
    'm.f2.t': 'プライバシー重視', 'm.f2.d': '必要なデータのみを取得し、第三者に販売することはありません。',
    'm.f3.t': '丁寧なデザイン', 'm.f3.d': 'すっきりしたインターフェース、ダークモード、ネイティブらしい細部。',
    'm.f4.t': 'オフライン対応', 'm.f4.d': 'インターネットがなくても主要な機能が使えます。',
    'm.f5.t': '多言語対応', 'm.f5.d': 'スペイン語、英語、日本語、イタリア語、フランス語、ドイツ語に対応。',
    'm.f6.t': '本物のサポート', 'm.f6.d': '実際のスタッフが 48 時間以内にご質問にお答えします。',
    'm.steps': '3 ステップではじめる',
    'm.s1.t': 'ダウンロード', 'm.s1.d': 'App Store または Google Play で検索して、無料でインストール。',
    'm.s2.t': '設定', 'm.s2.d': '長いフォームなしで、1 分以内に好みを設定。',
    'm.s3.t': '使う', 'm.s3.d': '完了。大切なことはすべてワンタップで。',
    'm.cta.t': 'さっそく試してみませんか？',
    'm.cta.d': '無料でダウンロードして、ご感想をお聞かせください。皆さまの声が次のバージョンをより良くします。',
    'm.press.t': 'プレス・提携',
    'm.press.d': '取材、提携、メディアキット（ロゴ、スクリーンショット、アイコン）のご依頼は、お気軽にご連絡ください。',
    'm.press.btn': 'お問い合わせ',
  },

  /* ------------------------------------------------ EN */
  en: {
    'back': 'Back to home',
    'lang': 'Language',
    'foot.rights': 'All rights reserved.',
    'foot.support': 'Support',
    'foot.marketing': 'Apps',
    'foot.home': 'Home',
    'foot.privacy': 'Privacy',

    'p.meta': 'Privacy policies — fukudamiyasato',
    'p.kicker': 'Privacy',
    'p.title': 'Privacy policies',
    'p.lead': 'Choose an app to read its privacy policy.',
    'p.general': 'General — all apps',

    's.meta': 'Support — fukudamiyasato',
    's.kicker': 'Support',
    's.title': 'How can we <em>help</em>?',
    's.lead': 'Find answers to the most common questions about our iOS and Android apps, or email us directly and we’ll get back to you soon.',
    's.c1.t': 'Contact us',
    's.c1.d': 'Send us an email. We reply within 24–48 business hours.',
    's.c2.t': 'FAQ',
    's.c2.d': 'Purchases, subscriptions, accounts and technical issues.',
    's.c3.t': 'Your data',
    's.c3.d': 'We never sell your data. Request access or deletion at any time.',
    's.faq': 'Frequently asked questions',
    's.q1': 'How do I contact support?',
    's.a1': 'Email us at the address on this page and include the name of the app. We reply within 24 to 48 business hours.',
    's.q2': 'How do I request a refund?',
    's.a2': 'Payments are processed by the App Store or Google Play, so refunds are handled by them. On iOS, go to reportaproblem.apple.com; on Android, open Google Play › Payments & subscriptions › Budget & history.',
    's.q3': 'How do I restore my purchases?',
    's.a3': 'Open the app, go to Settings and tap “Restore purchases”. Make sure you’re signed in with the same Apple ID or Google account you used to buy.',
    's.q4': 'How do I cancel a subscription?',
    's.a4': 'On iPhone: Settings › [your name] › Subscriptions. On Android: Google Play › Profile › Payments & subscriptions › Subscriptions. Deleting the app does not cancel your subscription.',
    's.q5': 'How do I delete my account and data?',
    's.a5': 'You can do it from the app settings or by emailing us from the address linked to your account. We delete all your data within 30 days.',
    's.q6': 'The app crashes or doesn’t work properly',
    's.a6': 'Update to the latest version, restart your device and, if it still fails, reinstall the app. If the problem persists, email us with your device model, OS version, app version and the steps to reproduce it.',
    's.q7': 'Which devices are supported?',
    's.a7': 'Generally, iPhone and iPad running iOS 16 or later and Android phones running 8.0 or later. Check each app’s store listing for exact requirements.',
    's.contact.t': 'Still need help?',
    's.contact.d': 'To solve it faster, please include in your message:',
    's.contact.l1': 'App name and version',
    's.contact.l2': 'Device model and iOS / Android version',
    's.contact.l3': 'What happened and how to reproduce it (screenshots help)',
    's.contact.btn': 'Email support',
    's.contact.time': 'Reply within 24–48 business hours',

    'm.meta': 'Apps — fukudamiyasato',
    'm.kicker': 'Apps for iOS & Android',
    'm.title': 'Simple, fast, <em>well-made</em> apps.',
    'm.lead': 'We design and build apps that do one thing and do it well: clear interfaces, no clutter, made for your everyday life.',
    'm.ios.s': 'Download on the',
    'm.android.s': 'Get it on',
    'm.feat': 'Why our apps',
    'm.f1.t': 'Fast', 'm.f1.d': 'They open instantly and respond to every tap, even on older devices.',
    'm.f2.t': 'Private', 'm.f2.d': 'We only ask for the data we need and never sell it to third parties.',
    'm.f3.t': 'Crafted design', 'm.f3.d': 'Clean interfaces, dark mode and details that feel truly native.',
    'm.f4.t': 'Works offline', 'm.f4.d': 'Key features stay available even without an internet connection.',
    'm.f5.t': 'Multilingual', 'm.f5.d': 'Available in Spanish, English, Japanese, Italian, French and German.',
    'm.f6.t': 'Real support', 'm.f6.d': 'Real people answer your questions in under 48 hours.',
    'm.steps': 'Get started in three steps',
    'm.s1.t': 'Download', 'm.s1.d': 'Find it on the App Store or Google Play and install it for free.',
    'm.s2.t': 'Set up', 'm.s2.d': 'Pick your preferences in under a minute — no long forms.',
    'm.s3.t': 'Enjoy', 'm.s3.d': 'Done. Everything that matters, one tap away.',
    'm.cta.t': 'Ready to try it?',
    'm.cta.d': 'Download it for free and tell us what you think. Your feedback makes every release better.',
    'm.press.t': 'Press & partnerships',
    'm.press.d': 'For press, partnerships or a media kit (logos, screenshots and icons), get in touch and we’ll send you everything you need.',
    'm.press.btn': 'Get in touch',
  },

  /* ------------------------------------------------ IT */
  it: {
    'back': 'Torna alla home',
    'lang': 'Lingua',
    'foot.rights': 'Tutti i diritti riservati.',
    'foot.support': 'Assistenza',
    'foot.marketing': 'App',
    'foot.home': 'Home',
    'foot.privacy': 'Privacy',

    'p.meta': 'Informative sulla privacy — fukudamiyasato',
    'p.kicker': 'Privacy',
    'p.title': 'Informative sulla privacy',
    'p.lead': 'Scegli un’app per leggere la sua informativa sulla privacy.',
    'p.general': 'Generale — tutte le app',

    's.meta': 'Assistenza — fukudamiyasato',
    's.kicker': 'Assistenza',
    's.title': 'Come possiamo <em>aiutarti</em>?',
    's.lead': 'Trova le risposte alle domande più comuni sulle nostre app per iOS e Android, oppure scrivici direttamente e ti risponderemo al più presto.',
    's.c1.t': 'Contattaci',
    's.c1.d': 'Scrivici via email. Rispondiamo entro 24–48 ore lavorative.',
    's.c2.t': 'Domande frequenti',
    's.c2.d': 'Acquisti, abbonamenti, account e problemi tecnici.',
    's.c3.t': 'I tuoi dati',
    's.c3.d': 'Non vendiamo i tuoi dati. Puoi richiederne l’accesso o la cancellazione in qualsiasi momento.',
    's.faq': 'Domande frequenti',
    's.q1': 'Come contatto l’assistenza?',
    's.a1': 'Scrivici all’indirizzo email di questa pagina indicando il nome dell’app. Rispondiamo entro 24–48 ore lavorative.',
    's.q2': 'Come richiedo un rimborso?',
    's.a2': 'I pagamenti sono gestiti da App Store o Google Play, quindi sono loro a occuparsi dei rimborsi. Su iOS vai su reportaproblem.apple.com; su Android apri Google Play › Pagamenti e abbonamenti › Budget e cronologia.',
    's.q3': 'Come ripristino i miei acquisti?',
    's.a3': 'Apri l’app, vai su Impostazioni e tocca «Ripristina acquisti». Assicurati di usare lo stesso ID Apple o account Google con cui hai acquistato.',
    's.q4': 'Come annullo un abbonamento?',
    's.a4': 'Su iPhone: Impostazioni › [il tuo nome] › Abbonamenti. Su Android: Google Play › Profilo › Pagamenti e abbonamenti › Abbonamenti. Eliminare l’app non annulla l’abbonamento.',
    's.q5': 'Come elimino il mio account e i miei dati?',
    's.a5': 'Puoi farlo dalle impostazioni dell’app oppure scrivendoci dall’email associata al tuo account. Eliminiamo tutti i tuoi dati entro 30 giorni.',
    's.q6': 'L’app si chiude o non funziona bene',
    's.a6': 'Aggiorna all’ultima versione, riavvia il dispositivo e, se il problema persiste, reinstalla l’app. Se continua, scrivici indicando modello del dispositivo, versione del sistema, versione dell’app e i passaggi per riprodurlo.',
    's.q7': 'Quali dispositivi sono compatibili?',
    's.a7': 'In generale iPhone e iPad con iOS 16 o successivo e telefoni Android 8.0 o successivo. Controlla la scheda di ogni app nello store per i requisiti esatti.',
    's.contact.t': 'Hai ancora bisogno di aiuto?',
    's.contact.d': 'Per risolvere più rapidamente, includi nel messaggio:',
    's.contact.l1': 'Nome e versione dell’app',
    's.contact.l2': 'Modello del dispositivo e versione di iOS / Android',
    's.contact.l3': 'Cosa è successo e come riprodurlo (gli screenshot aiutano)',
    's.contact.btn': 'Scrivi all’assistenza',
    's.contact.time': 'Risposta entro 24–48 ore lavorative',

    'm.meta': 'App — fukudamiyasato',
    'm.kicker': 'App per iOS e Android',
    'm.title': 'App semplici, veloci e <em>fatte bene</em>.',
    'm.lead': 'Progettiamo e sviluppiamo app che fanno una cosa e la fanno bene: interfacce chiare, senza distrazioni, pensate per la tua vita quotidiana.',
    'm.ios.s': 'Scarica su',
    'm.android.s': 'Disponibile su',
    'm.feat': 'Perché le nostre app',
    'm.f1.t': 'Veloci', 'm.f1.d': 'Si aprono all’istante e rispondono a ogni tocco, anche sui dispositivi meno recenti.',
    'm.f2.t': 'Private', 'm.f2.d': 'Chiediamo solo i dati necessari e non li vendiamo mai a terzi.',
    'm.f3.t': 'Design curato', 'm.f3.d': 'Interfacce pulite, modalità scura e dettagli dal feeling nativo.',
    'm.f4.t': 'Offline', 'm.f4.d': 'Le funzioni principali restano disponibili anche senza connessione.',
    'm.f5.t': 'Multilingua', 'm.f5.d': 'Disponibili in spagnolo, inglese, giapponese, italiano, francese e tedesco.',
    'm.f6.t': 'Assistenza vera', 'm.f6.d': 'Persone reali rispondono alle tue domande in meno di 48 ore.',
    'm.steps': 'Inizia in tre passi',
    'm.s1.t': 'Scarica', 'm.s1.d': 'Cercala su App Store o Google Play e installala gratis.',
    'm.s2.t': 'Configura', 'm.s2.d': 'Scegli le tue preferenze in meno di un minuto, senza moduli lunghi.',
    'm.s3.t': 'Usala', 'm.s3.d': 'Fatto. Tutto ciò che conta, a un tocco di distanza.',
    'm.cta.t': 'Pronto a provarla?',
    'm.cta.d': 'Scaricala gratis e dicci cosa ne pensi. Il tuo feedback migliora ogni versione.',
    'm.press.t': 'Stampa e collaborazioni',
    'm.press.d': 'Per stampa, partnership o media kit (loghi, screenshot e icone), scrivici e ti invieremo tutto il necessario.',
    'm.press.btn': 'Contattaci',
  },

  /* ------------------------------------------------ FR */
  fr: {
    'back': 'Retour à l’accueil',
    'lang': 'Langue',
    'foot.rights': 'Tous droits réservés.',
    'foot.support': 'Assistance',
    'foot.marketing': 'Apps',
    'foot.home': 'Accueil',
    'foot.privacy': 'Confidentialité',

    'p.meta': 'Politiques de confidentialité — fukudamiyasato',
    'p.kicker': 'Confidentialité',
    'p.title': 'Politiques de confidentialité',
    'p.lead': 'Choisissez une app pour consulter sa politique de confidentialité.',
    'p.general': 'Générale — toutes les apps',

    's.meta': 'Assistance — fukudamiyasato',
    's.kicker': 'Assistance',
    's.title': 'Comment pouvons-nous vous <em>aider</em> ?',
    's.lead': 'Trouvez les réponses aux questions les plus fréquentes sur nos applications iOS et Android, ou écrivez-nous directement : nous vous répondrons rapidement.',
    's.c1.t': 'Nous contacter',
    's.c1.d': 'Écrivez-nous par e-mail. Réponse sous 24 à 48 heures ouvrées.',
    's.c2.t': 'Questions fréquentes',
    's.c2.d': 'Achats, abonnements, comptes et problèmes techniques.',
    's.c3.t': 'Vos données',
    's.c3.d': 'Nous ne vendons jamais vos données. Demandez-en l’accès ou la suppression à tout moment.',
    's.faq': 'Questions fréquentes',
    's.q1': 'Comment contacter l’assistance ?',
    's.a1': 'Écrivez-nous à l’adresse indiquée sur cette page en précisant le nom de l’application. Nous répondons sous 24 à 48 heures ouvrées.',
    's.q2': 'Comment demander un remboursement ?',
    's.a2': 'Les paiements sont traités par l’App Store ou Google Play : ce sont donc eux qui gèrent les remboursements. Sur iOS, rendez-vous sur reportaproblem.apple.com ; sur Android, ouvrez Google Play › Paiements et abonnements › Budget et historique.',
    's.q3': 'Comment restaurer mes achats ?',
    's.a3': 'Ouvrez l’application, allez dans Réglages et touchez « Restaurer les achats ». Utilisez le même identifiant Apple ou compte Google que lors de l’achat.',
    's.q4': 'Comment résilier un abonnement ?',
    's.a4': 'Sur iPhone : Réglages › [votre nom] › Abonnements. Sur Android : Google Play › Profil › Paiements et abonnements › Abonnements. Supprimer l’application ne résilie pas l’abonnement.',
    's.q5': 'Comment supprimer mon compte et mes données ?',
    's.a5': 'Depuis les réglages de l’application, ou en nous écrivant depuis l’adresse e-mail associée à votre compte. Toutes vos données sont supprimées sous 30 jours maximum.',
    's.q6': 'L’application plante ou ne fonctionne pas correctement',
    's.a6': 'Mettez à jour vers la dernière version, redémarrez l’appareil puis, si besoin, réinstallez l’application. Si le problème persiste, écrivez-nous avec le modèle de l’appareil, la version du système, la version de l’application et les étapes pour le reproduire.',
    's.q7': 'Quels appareils sont compatibles ?',
    's.a7': 'En général, iPhone et iPad sous iOS 16 ou ultérieur et téléphones Android 8.0 ou ultérieur. Consultez la fiche de chaque application sur le store pour les exigences exactes.',
    's.contact.t': 'Besoin d’aide supplémentaire ?',
    's.contact.d': 'Pour une résolution plus rapide, indiquez dans votre message :',
    's.contact.l1': 'Nom et version de l’application',
    's.contact.l2': 'Modèle de l’appareil et version d’iOS / Android',
    's.contact.l3': 'Ce qui s’est passé et comment le reproduire (les captures aident)',
    's.contact.btn': 'Écrire à l’assistance',
    's.contact.time': 'Réponse sous 24 à 48 h ouvrées',

    'm.meta': 'Apps — fukudamiyasato',
    'm.kicker': 'Apps pour iOS et Android',
    'm.title': 'Des apps simples, rapides et <em>bien faites</em>.',
    'm.lead': 'Nous concevons et développons des applications qui font une chose, et la font bien : des interfaces claires, sans superflu, pensées pour votre quotidien.',
    'm.ios.s': 'Télécharger dans l’',
    'm.android.s': 'Disponible sur',
    'm.feat': 'Pourquoi nos apps',
    'm.f1.t': 'Rapides', 'm.f1.d': 'Elles s’ouvrent instantanément et réagissent à chaque geste, même sur les anciens appareils.',
    'm.f2.t': 'Confidentielles', 'm.f2.d': 'Nous ne demandons que les données nécessaires et ne les vendons jamais.',
    'm.f3.t': 'Design soigné', 'm.f3.d': 'Interfaces épurées, mode sombre et détails vraiment natifs.',
    'm.f4.t': 'Hors ligne', 'm.f4.d': 'Les fonctions essentielles restent disponibles sans connexion internet.',
    'm.f5.t': 'Multilingues', 'm.f5.d': 'Disponibles en espagnol, anglais, japonais, italien, français et allemand.',
    'm.f6.t': 'Vraie assistance', 'm.f6.d': 'De vraies personnes répondent à vos questions en moins de 48 heures.',
    'm.steps': 'Commencez en trois étapes',
    'm.s1.t': 'Téléchargez', 'm.s1.d': 'Trouvez-la sur l’App Store ou Google Play et installez-la gratuitement.',
    'm.s2.t': 'Configurez', 'm.s2.d': 'Choisissez vos préférences en moins d’une minute, sans longs formulaires.',
    'm.s3.t': 'Profitez', 'm.s3.d': 'C’est prêt. L’essentiel, à portée de doigt.',
    'm.cta.t': 'Prêt à l’essayer ?',
    'm.cta.d': 'Téléchargez-la gratuitement et dites-nous ce que vous en pensez. Vos retours améliorent chaque version.',
    'm.press.t': 'Presse et partenariats',
    'm.press.d': 'Pour la presse, les partenariats ou un kit média (logos, captures et icônes), contactez-nous et nous vous enverrons tout le nécessaire.',
    'm.press.btn': 'Nous contacter',
  },

  /* ------------------------------------------------ DE */
  de: {
    'back': 'Zur Startseite',
    'lang': 'Sprache',
    'foot.rights': 'Alle Rechte vorbehalten.',
    'foot.support': 'Support',
    'foot.marketing': 'Apps',
    'foot.home': 'Start',
    'foot.privacy': 'Datenschutz',

    'p.meta': 'Datenschutzerklärungen — fukudamiyasato',
    'p.kicker': 'Datenschutz',
    'p.title': 'Datenschutzerklärungen',
    'p.lead': 'Wähle eine App, um ihre Datenschutzerklärung zu lesen.',
    'p.general': 'Allgemein — alle Apps',

    's.meta': 'Support — fukudamiyasato',
    's.kicker': 'Support',
    's.title': 'Wie können wir <em>helfen</em>?',
    's.lead': 'Hier findest du Antworten auf die häufigsten Fragen zu unseren iOS- und Android-Apps – oder schreib uns direkt, wir melden uns schnell.',
    's.c1.t': 'Kontakt',
    's.c1.d': 'Schreib uns eine E-Mail. Wir antworten innerhalb von 24–48 Werktagsstunden.',
    's.c2.t': 'Häufige Fragen',
    's.c2.d': 'Käufe, Abos, Konten und technische Probleme.',
    's.c3.t': 'Deine Daten',
    's.c3.d': 'Wir verkaufen deine Daten nie. Auskunft oder Löschung jederzeit möglich.',
    's.faq': 'Häufig gestellte Fragen',
    's.q1': 'Wie erreiche ich den Support?',
    's.a1': 'Schreib uns an die E-Mail-Adresse auf dieser Seite und nenne den Namen der App. Wir antworten innerhalb von 24 bis 48 Werktagsstunden.',
    's.q2': 'Wie beantrage ich eine Rückerstattung?',
    's.a2': 'Zahlungen werden über den App Store oder Google Play abgewickelt, daher bearbeiten diese auch Rückerstattungen. Unter iOS über reportaproblem.apple.com, unter Android über Google Play › Zahlungen & Abos › Budget & Verlauf.',
    's.q3': 'Wie stelle ich meine Käufe wieder her?',
    's.a3': 'Öffne die App, gehe zu Einstellungen und tippe auf „Käufe wiederherstellen“. Nutze dieselbe Apple-ID bzw. dasselbe Google-Konto wie beim Kauf.',
    's.q4': 'Wie kündige ich ein Abo?',
    's.a4': 'Auf dem iPhone: Einstellungen › [dein Name] › Abonnements. Unter Android: Google Play › Profil › Zahlungen & Abos › Abos. Das Löschen der App kündigt das Abo nicht.',
    's.q5': 'Wie lösche ich mein Konto und meine Daten?',
    's.a5': 'Direkt in den App-Einstellungen oder per E-Mail von der Adresse, die mit deinem Konto verknüpft ist. Wir löschen alle deine Daten innerhalb von höchstens 30 Tagen.',
    's.q6': 'Die App stürzt ab oder funktioniert nicht richtig',
    's.a6': 'Aktualisiere auf die neueste Version, starte dein Gerät neu und installiere die App bei Bedarf neu. Besteht das Problem weiterhin, schreib uns Gerätemodell, Systemversion, App-Version und die Schritte zur Reproduktion.',
    's.q7': 'Welche Geräte werden unterstützt?',
    's.a7': 'In der Regel iPhone und iPad ab iOS 16 sowie Android-Smartphones ab Version 8.0. Die genauen Anforderungen findest du im Store-Eintrag der jeweiligen App.',
    's.contact.t': 'Brauchst du weiterhin Hilfe?',
    's.contact.d': 'Damit wir schneller helfen können, gib bitte Folgendes an:',
    's.contact.l1': 'Name und Version der App',
    's.contact.l2': 'Gerätemodell und iOS- / Android-Version',
    's.contact.l3': 'Was passiert ist und wie man es reproduziert (Screenshots helfen)',
    's.contact.btn': 'Support kontaktieren',
    's.contact.time': 'Antwort innerhalb von 24–48 Werktagsstunden',

    'm.meta': 'Apps — fukudamiyasato',
    'm.kicker': 'Apps für iOS & Android',
    'm.title': 'Einfache, schnelle und <em>durchdachte</em> Apps.',
    'm.lead': 'Wir gestalten und entwickeln Apps, die eine Sache richtig gut machen: klare Oberflächen, kein Ballast, gemacht für deinen Alltag.',
    'm.ios.s': 'Laden im',
    'm.android.s': 'Jetzt bei',
    'm.feat': 'Warum unsere Apps',
    'm.f1.t': 'Schnell', 'm.f1.d': 'Sie starten sofort und reagieren auf jede Berührung – auch auf älteren Geräten.',
    'm.f2.t': 'Privat', 'm.f2.d': 'Wir fragen nur nötige Daten ab und verkaufen sie niemals an Dritte.',
    'm.f3.t': 'Sorgfältiges Design', 'm.f3.d': 'Klare Oberflächen, Dark Mode und Details, die sich nativ anfühlen.',
    'm.f4.t': 'Offline nutzbar', 'm.f4.d': 'Die wichtigsten Funktionen bleiben auch ohne Internet verfügbar.',
    'm.f5.t': 'Mehrsprachig', 'm.f5.d': 'Verfügbar auf Spanisch, Englisch, Japanisch, Italienisch, Französisch und Deutsch.',
    'm.f6.t': 'Echter Support', 'm.f6.d': 'Echte Menschen beantworten deine Fragen in weniger als 48 Stunden.',
    'm.steps': 'In drei Schritten loslegen',
    'm.s1.t': 'Herunterladen', 'm.s1.d': 'Im App Store oder bei Google Play finden und kostenlos installieren.',
    'm.s2.t': 'Einrichten', 'm.s2.d': 'Wähle deine Einstellungen in weniger als einer Minute – ohne lange Formulare.',
    'm.s3.t': 'Loslegen', 'm.s3.d': 'Fertig. Alles Wichtige nur einen Fingertipp entfernt.',
    'm.cta.t': 'Bereit, es auszuprobieren?',
    'm.cta.d': 'Lade sie kostenlos herunter und sag uns deine Meinung. Dein Feedback macht jede Version besser.',
    'm.press.t': 'Presse & Kooperationen',
    'm.press.d': 'Für Presse, Kooperationen oder ein Media-Kit (Logos, Screenshots und Icons) melde dich – wir schicken dir alles, was du brauchst.',
    'm.press.btn': 'Kontakt aufnehmen',
  },
};

const KEY = 'fm-lang';
const codes = LANGS.map((l) => l.code);

function store(get, value) {
  try {
    if (get) return localStorage.getItem(KEY);
    localStorage.setItem(KEY, value);
  } catch { /* modo privado: sin memoria, no pasa nada */ }
  return null;
}

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (codes.includes(q)) { store(false, q); return q; }
  const saved = store(true);
  if (codes.includes(saved)) return saved;
  for (const l of navigator.languages ?? [navigator.language]) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (codes.includes(c)) return c;
  }
  return 'es';
}

/* Textos propios de una página (p. ej. la política de Kofres): se cargan
   de /js/i18n-<nombre>.js cuando el <body> trae data-dict="<nombre>". */
const extra = document.body.dataset.dict;
if (extra) {
  const mod = await import(`./i18n-${extra}.js`);
  for (const c of Object.keys(T)) Object.assign(T[c], mod.default[c]);
}

function apply(lang) {
  const dict = T[lang];
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = dict[el.dataset.i18n];
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = dict[el.dataset.i18nHtml];
    if (v != null) el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const v = dict[el.dataset.i18nAria];
    if (v != null) el.setAttribute('aria-label', v);
  });
  const meta = document.body.dataset.meta;
  if (meta && dict[meta]) document.title = dict[meta];

  document.getElementById('lang-current').textContent = LANGS.find((l) => l.code === lang).name;
  document.querySelectorAll('#lang-menu button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.lang === lang));
  });
}

/* ---------- dropdown ---------- */
const btn = document.getElementById('lang-btn');
const menu = document.getElementById('lang-menu');

menu.innerHTML = LANGS.map((l) =>
  `<li><button type="button" role="menuitem" data-lang="${l.code}">${l.name}<small>${l.code}</small></button></li>`
).join('');

function toggle(open) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

btn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggle(menu.hidden);
});
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (!b) return;
  apply(b.dataset.lang);
  store(false, b.dataset.lang);
  toggle(false);
  btn.focus();
});
document.addEventListener('click', (e) => {
  if (!menu.hidden && !e.target.closest('.lang')) toggle(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) { toggle(false); btn.focus(); }
});

/* ---------- correo y año ---------- */
document.querySelectorAll('[data-email]').forEach((a) => {
  a.href = `mailto:${CONFIG.me.email}`;
  if (a.hasAttribute('data-email-text')) a.textContent = CONFIG.me.email;
});
document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

apply(initialLang());
