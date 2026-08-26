// Bump on ANY change to prompts/schemas below: it versions cache keys and
// is stamped onto structured rows so a prompt regression can be traced back
// to the questions it produced.
//
// 6 was the batch worker's first generation: same texts, assembled differently
// for Anthropic, and the first to write rows. A row stamped 5 was read by a
// browser through Gemini; a row stamped 6 by the worker through Anthropic.
//
// 7 adds the `geometry` figure kind. This one is a real change to what is
// asked for, not just how: a question whose diagram is an angle construction
// now has somewhere structured to put its bisector ticks and right-angle
// squares instead of falling through to hand-written SVG that drops them. Rows
// stamped 6 and 7 can hold visibly different figures for the same crop, which
// is exactly what the version is for.
export const PROMPT_VERSION = 12

// Prompt texts for the question-recreation pipeline. Shared by the
// question-ops Edge Function and the Node eval harness — ONE source of truth,
// so a prompt tweak is automatically covered by the regression fixtures.
// Runtime-agnostic: no env, no DOM, no model ids (the caller picks models).
//
// The extraction rules are ported from the exam MVP where each one encodes a
// real, repeated failure mode of this exact book format. Translate carefully,
// never "improve" casually — the eval harness is the gate for changes.

const SYSTEM_HEAD = `Sən Türk/Azərbaycan riyaziyyat sual bankından BİR sualı rəqəmsallaşdırırsan. Yalnız verilmiş JSON sxeminə uyğun cavab qaytar.
Sualın MƏZMUNUNA özündən heç nə əlavə etmə və heç nəyi dəyişmə — çapdakının eynisini köçür. figures/is_image kimi STRUKTUR sahələri isə sxem tələb etdiyi kimi MÜTLƏQ doldur.

Qaydalar:
1. Şəkildə diaqonal watermark ola bilər — onu TAM İQNOR ET, heç vaxt köçürmə.
2. Türk mətnini eynilə saxla (ç, ş, ğ, ı, ö, ü; onluq vergüllər 1,62 vergül qalır).
3. Riyaziyyatı KaTeX-uyğun LaTeX ilə $...$ içində yaz; hissəli funksiyalar \\begin{cases}.
4. "⇒ ... = ?" sətri stem-in bir hissəsidir. Sual nömrəsini stem-ə salma. Sualı HƏLL ETMƏ.
5. Variantlar dəqiq A–E; məzmun qeyri-rəqəmi ola bilər (hərf, çoxluq, interval). Variant tex-ində $ işarəsi OLMASIN — sistem özü math rejimində göstərir. Çoxluq mötərizələri üçün \\{ və \\} yaz: "{e,m}" yox, "\\{e,m\\}".
6. Əgər hər hansı hissə oxunmursa (üst-üstə çap və s.) illegible=true qoy və uydurma.
7. Hər variant YA mətndir, YA şəkil — ikisindən biri, boş qalan variant olmamalıdır:
   - MƏTN variantı: yalnız tex doldur (is_image və box vermə).
   - ŞƏKİL variantı (fiqur, qrafik, forma, rəngli xanalar): is_image=true VƏ box — HƏR İKİSİ məcburidir. box olmasa həmin variant tamamilə itir.
   Şəkil variantında tex sahəsini sadəcə boş burax — ora nə şəklin içindəki rəqəmləri, nə izahat, nə də öz mülahizəni yaz.
   Bir variant şəkildirsə, çox güman BEŞİ də şəkildir — hamısına ayrı-ayrı box ver, heç birini ötürmə.

   ┌─ BOX QAYDASI — hər box üçün (variant şəkli də, kind="image" fiquru da) ─┐
   box=[ymin, xmin, ymax, xmax], 0–1000 normallaşdırılmış (0 = yuxarı/sol).
   a) Qutu elementin BÜTÜN görünən məzmununu əhatə etməlidir — yuxarıdan aşağıya,
      soldan sağa. Elementin heç bir hissəsi (dairə, üçbucaq, ox, nöqtə, rəng
      ləkəsi) qutudan kənarda qalmamalıdır.
   b) Aşağı sərhəd: NÖVBƏTİ elementin başladığı yerə qədər uzat. A variantının
      qutusu B variantının hərfinə çatana qədər davam edir; sonuncu variant
      üçün sətrin sonuna qədər.
   c) Element sətir içi bir başlığın ALTINDADIRSA — məsələn "A = ? ; B = ? ; C = ?"
      kimi bir sətir və onun altında rəngli dairələr — həmin başlığın ALTINDAKI
      məzmun elementin özüdür. Qutunu başlığın sətrinə qoyma; aşağı, əsl
      məzmunun üstünə sal.
   d) Şübhə varsa BÖYÜK götür. Bir az geniş qutu bir az ağ boşluq gətirir və
      heç nəyə zərər vermir; DAR qutu fiqurun yarısını kəsir və variant itir.
      Variant hərfini ("A)") mümkünsə kənarda saxla, amma hərfi kənarda saxlamaq
      üçün məzmunu kəsmə — məzmun hərfdən vacibdir.
   e) Yazmadan ÖNCƏ yoxla: elementin ən yuxarı, ən aşağı, ən sol və ən sağ
      nöqtəsi qutunun içindədirmi? Yoxsa sərhədi genişləndir.
   └────────────────────────────────────────────────────────────────────────┘
8. difficulty: sualın YÖS imtahanı kontekstində çətinliyini 1–5 arası qiymətləndir (1=çox asan, 3=orta, 5=çox çətin).
9. confidence: ÇƏTİNLİK DEYİL — bu, sənin OXUNUŞUNUN dəqiqliyidir: 1.0 = hər simvolu aydın oxudum, şübhəm yoxdur; 0.85 = oxudum, amma bir-iki simvolda (indeks, üst işarə, kiçik rəqəm) tərəddüd var; 0.5 = xeyli hissəni təxmin etdim. 0.85-dən aşağı hər şey insan yoxlamasına göndərilir, ona görə dürüst qiymətləndir — yüksək rəqəm sənə fayda vermir.
10. Səhifədə çəkilmiş şəkil (diaqram, qrafik, cədvəl, sxem) varsa figure_box=[ymin,xmin,ymax,xmax] (0–1000) ver — YALNIZ rəsmin ətrafı. Sual mətni, "⇒ ... = ?" sətri və cavab variantları qutuya DAXİL OLMAMALIDIR. Şəkil yoxdursa figure_box vermə.
11. Stem-də çap olunmuş hər şərt AYRICA sətirdə olsun — sətirlər arasında \\n istifadə et, şərtləri bir cümləyə yığma.
    VACİB: \\n HEÇVAXT $...$ math blokunun İÇİNDƏ olmasın — hər sətri ÖZ $...$ blokuna sal:
    DÜZGÜN: "$f(a+b)=f(a)+f(b)$\\n$f(7)=?$"  SƏHV: "$f(a+b)=f(a)+f(b)\\nf(7)=?$"`

// Rules 9-11: the declarative FigSpec instructions — only for the DSL lanes.
const SYSTEM_FIGURE_RULES = `12. Fiqurlar: deklarativ spec ver, şəkil çəkmə.
   - Ox etiketlərini (simvolik olsa belə: 2a, -a/2), hər işarəli nöqtəni, qırıq bələdçi xətti, əyri rəngini və adını şəkildən oxu.
   - QRAFİK NƏ VAXT function_graph OLA BİLƏR: YALNIZ əyrinin düsturu KONKRET və HESABLANA BİLƏNdirsə
     (məs. y=x^2-3, y=2x+1) — bütün sabitlər məlum olmalıdır. curve_type="expr" ver.
     Düsturu bilinməyən, parametrik və ya adı çəkilməyən əyri (y=af(x+b), "f-in qrafiki şəkildəki kimidir",
     sərbəst dalğalı forma) function_graph DEYİL — kind="image" ver.
     SABİT UYDURMA: stem "f(x)=ax^3" deyirsə və a naməlumdursa, a-nın yerinə 0.335 kimi rəqəm YAZMA —
     bu, uydurulmuş düsturdur və doğru kimi çəkilir. Belə hallarda kind="image".
   - Venn/çoxluq diaqramı — kind="venn" YALNIZ bu ÜÇ şərtin HAMISI ödənəndə:
       (1) bütün çoxluqlar DAİRƏdir (üçbucaq, düzbucaqlı, oval və ya başqa forma varsa — kind="image");
       (2) hər çoxluğun adı TƏK BÖYÜK HƏRFdir (A, B, C). "A\\B", "A∪B" kimi ad ƏMƏLİYYATdır, ad deyil — kind="image";
       (3) ştrixlənmiş bölgə ∩ ∪ - ' ( ) ilə yazıla bilir.
     Şərtlərdən biri pozulursa fiquru ÇƏKMƏ — kind="image" ver, biz orijinaldan kəsirik.
     Şərtlər ödənirsə: kətan ~300x230 px, tipik iki dairə: cx=115 və cx=185, cy=115, r=70.
       id = şəkildəki AD (A, B, C, K, L, M); label = eyni ad.
       color: şəkildəki rəngə uyğun token seç — qırmızı→primary, mavi/göy→secondary, yaşıl→guide, qara→ink, boz→muted.
     shaded: ştrixlənmiş bölgənin çoxluq ifadəsi — bölgəni ÇƏKMƏ, ifadəni yaz.
     region_labels: bölgələrin İÇİNDƏ çap olunmuş HƏR yazı üçün (say, hərf, element siyahısı) BİR giriş {expr, tex} — heç birini buraxma:
       məsələn K-da 2, kəsişmədə "1, 2, a", L-də 3, çölündə "e,f" →
       [{"expr":"K-L","tex":"2"},{"expr":"K∩L","tex":"1,\\ 2,\\ a"},{"expr":"L-K","tex":"3"},{"expr":"(K∪L)'","tex":"e,f"}]
     expr sintaksisi: YALNIZ id adları və ∩ ∪ - ' ( ) simvolları. LaTeX YAZMA (\\cap yox!). Bütün formalar, ştrixləmə və region_labels EYNİ BİR venn fiqurunda olmalıdır — onları ayrı fiqurlara BÖLMƏ.
     universe_label: xarici düzbucaqlı çərçivə varsa onun etiketi (U, E...).
   - İki yanaşı koordinat müstəvisi = BİR fiqurun iki paneli, iki sual DEYİL.
13. TÜRK BÖLMƏ SXEMİ (şaquli xətli bölmə) — kind="division_scheme", KƏSR DEYİL:
   dividend_tex = xəttin SOLUNDAKI yuxarı ifadə (bölünən);
   divisor_tex = xəttin SAĞINDAKI yuxarı ifadə (bölən);
   quotient_tex = bölənin ALTINDAKI ifadə (qismət, üfüqi xəttdən sonra);
   remainder_tex = bölünənin altındakı çıxma addımından qalan ƏN AŞAĞI ifadə (qalıq).
   Nümunə: A│B sxemi, B-nin altında 4, A-nın altında 5 → {"dividend_tex":"A","divisor_tex":"B","quotient_tex":"4","remainder_tex":"5"}.
   DÖRD ROL POZİSİYA İLƏ AYRILIR: sol-yuxarı=bölünən, sağ-yuxarı=bölən, sağ-aşağı=bölüm, sol-aşağı=qalıq.
   Hər rol ÖZ xanasına. Xananın içinə "/" və ya \\frac YAZMA — bir xanada iki rol olmaz.
   Xanalar ifadədirsə (n^2, K+4, a+1) rollar asan qarışır: şəkildəki YERİNƏ bax, ifadənin özünə yox.
   Səhifədə YANAŞI iki sxem varsa İKİSİNİ də ver və layout_direction="row" qoy — biri şərt, o biri sualdır.
14. ŞAQULİ HESAB (alt-alta çarpma/toplama) — kind="vertical_arithmetic":
   rows = çap olunduğu sıra ilə YUXARIDAN AŞAĞI hər sətir; sətrin solunda operator varsa həmin sətrə op yaz ("×" vuruq sətrində, "+" sürüşdürülmüş hissə-hasil sətrində);
   gizli rəqəmlər üçün hər nöqtə əvəzinə "•" simvolu (məs. "••••");
   sola sürüşmüş sətirlər üçün indent (rəqəm mövqeyi sayı);
   üfüqi xətlər hline_after-də (0-əsaslı sətir indeksindən SONRA);
   ən aşağı nəticə sətri result_tex.
   Nümunə: ••••×36, altda xətt, •••••, +9762 (1 sola), xətt, •••••• →
   {"rows":[{"tex":"••••"},{"tex":"36","op":"×"},{"tex":"•••••"},{"tex":"9762","op":"+","indent":1}],"hline_after":[1,3],"result_tex":"••••••"}.
15. MÜSTƏVİ HƏNDƏSƏ (bucaqlar, şüalar, üçbucaqlar, paralel xətlər) — kind="geometry".
   Bu növ raw_svg-dən ÜSTÜNDÜR: həndəsi şəkil çəkirsənsə və nöqtə/xətt/bucaqla ifadə oluna bilirsə, raw_svg YOX, geometry ver.
   points: hər adlandırılmış nöqtə {id, x, y, label, dot}. Koordinatlar sadə müstəvi, y AŞAĞI (SVG kimi), width/height ver (məs. 320x240).
   lines: {from, to, kind} — kind="segment" (parça), "ray" (şüa, from-dan to istiqamətinə sonsuz), "line" (düz xətt, hər iki tərəfə sonsuz).
   İŞARƏLƏR — bunlar bəzək deyil, sualın ŞƏRTİDİR; şəkildə varsa MÜTLƏQ ver:
     ticks: 1-3 — bərabər uzunluq işarəsi. EYNİ say = həmin parçalar bərabərdir. YALNIZ kind="segment" üçün: şüanın/xəttin uzunluğu yoxdur, ona ticks vermə.
     İki şüa/xətt üzərindəki eyni işarələr demək olar ki, həmişə PARALELLİKDİR — ticks yox, parallel ver.
     parallel: 1-3 — paralellik oxu. EYNİ say = həmin xətlər paraleldir.
     angles[].right: true — düz bucaq. KVADRAT kimi çəkilir; "90°" yazılı qövs DEYİL.
     angles[].arcs: 1-3 — bərabər bucaq qövsü. EYNİ say = həmin bucaqlar bərabərdir; tənbölən (bisektris) məhz bununla bildirilir.
   angles: at=[qol, TƏPƏ, qol] — təpə ORTADA. label = çap olunmuş ölçü ("30°", "x", "2\\alpha").
   Ölçüləri şəkildən oxu. İşarəsiz verilən tənbölən və ya paralellik sualı həll oluna bilməyən başqa suala çevrilir.
16. İZOMETRİK KUBLAR (rəngli üzlü kublar sırası) — kind="cubes".
   Bu növ raw_svg-dən ÜSTÜNDÜR: kublar çəkirsənsə raw_svg YOX, cubes ver.
   cubes: soldan sağa hər kub {front, top, right} — YALNIZ göründüyü üzlər. Görünməyən üzü UYDURMA.
   Hər üz: {color:"#rrggbb"} üzün rəngi, {dot:"#rrggbb"} üzdəki rəngli nöqtə, {label:"A"} üzdə yazılmış hərf.
   Üz görünür amma boşdursa, boş obyekt ver — üzü tamamilə buraxmaq "görünmür" deməkdir, bu isə başqa fiqurdur.
   Rəngləri şəkildən oxu: bu suallarda cavab məhz rənglərin sırasındadır.
17. YUXARIDAKI NÖVLƏRDƏN HEÇ BİRİ FİQURU TAM TUTMURSA — kind="image", box ver. BAŞQA VARİANT YOXDUR.
   Simvolik piktoqramlar, sərbəst rəsmlər, naxışlar, mürəkkəb sxemlər — hamısı bura.
   kind="image" ver və box ilə fiqurun şəkildəki yerini göstər — 7-ci qaydadakı BOX QAYDASI
   burada da eyni ilə tətbiq olunur, xüsusən (a) və (d): fiqurun bütün hissələri qutunun içində olsun.
   Biz həmin sahəni orijinaldan KƏSİR və su nişanından TƏMİZLƏYİRİK, ona görə oxucu əsl fiquru görür.
   ÖZÜN SVG ÇƏKMƏ. Çəkə bilmədiyin fiquru təsvir etməyə çalışmaq, izahat və ya "təsvir etmək mümkün deyil"
   kimi qeyd yazmaq QADAĞANDIR — belə qeyd fiqurun yerində cümlə kimi görünür. Şübhə varsa kind="image".
   raw_svg içinə "təsvir etmək mümkün deyil" kimi QEYD YAZMA — qeyd fiqur deyil, və şəkilin yerində o cümlə görünür.
`


// The raster lane's replacement for rules 9-11: the figure arrives from the
// image model separately, so the vision model must NOT emit a figure spec.
const SYSTEM_NO_FIGURE_RULE = `12. SUALIN fiqurunu ÇIXARMA — figures sahəsini BOŞ saxla; sualın fiquru ayrıca sistem tərəfindən çəkilir.
    DİQQƏT: bu yalnız sualın öz fiquruna aiddir. 7-ci qayda — ŞƏKİLLİ VARİANTLAR — tam qüvvədədir:
    variantlar şəkildirsə, hər biri üçün is_image=true VƏ box mütləq verilməlidir. Onlarsız variantlar itir.`

/** Full system prompt for the DSL/plain lanes (declarative figure specs). */
export const EXTRACT_SYSTEM = [SYSTEM_HEAD, SYSTEM_FIGURE_RULES].join('\n')

/** System prompt for the raster lane (image model draws the figure). */
export const EXTRACT_SYSTEM_RASTER = [SYSTEM_HEAD, SYSTEM_NO_FIGURE_RULE].join('\n')



export const COMPARE_FIGURES_PROMPT = `İki şəkil verilir: (1) ORİJİNAL fiqur (watermark ola bilər), (2) YENİDƏN YARADILMIŞ fiqur.
Bunlar EYNİ fiqurdurmu? Topoloji/semantik müqayisə et, piksel dəqiqliyi YOX:
- Eyni formalar, eyni kəsişmə/yerləşmə strukturu?
- Bütün etiketlər, rəqəmlər, simvollar eynidirmi və DÜZGÜN bölgədədirmi?
- Ştrixlənmiş/rəngli bölgə eyni yerdədirmi?
Fərq varsa differences-də konkret yaz (məs. "b etiketi ellipsdən kənara sürüşüb", "3 rəqəmi çatışmır"). Watermark və kiçik üslub fərqlərini SAYMA.`


export const DETECT_QUESTIONS_PROMPT = `Bu, imtahan sual bankının BİR səhifəsidir. Vəzifən: HƏR sualın yerini tapmaq.

Qaydalar:
- Səhifə 1 və ya 2 sütunlu ola bilər. İki sütunlu səhifədə sol sütun column=0, sağ sütun column=1.
- Hər sual üçün box = [ymin, xmin, ymax, xmax], hər biri 0–1000 normallaşdırılmış (0 = yuxarı/sol, 1000 = aşağı/sağ).
  box BÜTÜN sualı əhatə etməlidir: sual nömrəsindən başlayıb şəkil/cədvəl və BÜTÜN cavab variantları (A–E) daxil olmaqla ən aşağı sətrə qədər.
- Sual nömrəsi rəqəmlə (1, 2, ...), rəngli disk içində rəqəmlə (❶) və ya nöqtəli (1.) ola bilər — hamısını tap.
- Səhifə başlığında "Test N" / "N. Deneme" varsa test_no-da qaytar.
- Watermark, dekorativ şəkillər (məs. qüllə silueti) və səhifə nömrəsini SUAL sayma.
- Sualları nömrə sırası ilə qaytar.`

export const PARSE_ANSWER_KEY_PROMPT = `Bu, imtahan kitabının CAVAB AÇARI səhifəsidir. Bütün cavabları çıxar.

Qaydalar:
- Hər giriş: sual nömrəsi (q_no) + cavab hərfi (A–E).
- Səhifədə "Test N" / "N. Deneme" başlıqları varsa, ALTINDAKI girişlərə həmin test_no-nu yaz; başlıq yoxdursa test_no vermə.
- Cədvəl sütunlarla düzülə bilər (1–20 solda, 21–40 sağda) — HAMISINI oxu, sütun sırası ilə.
- Boş və ya oxunmayan xanaları BURAXIB davam et — uydurma.
- Səhifə nömrəsini, başlıqları, reklamı sual sayma.`

// ---- verification: the recreated question against the printed original ----
//
// Written to find differences, not to confirm agreement. A verifier that agrees
// with everything is indistinguishable from one that works, and the failure is
// silent: rows arrive marked `verified`, auto-approve passes them, and nobody
// looks again. So the model is asked to ENUMERATE differences before reaching a
// verdict, and told explicitly which differences do not count — the recreation
// is deliberately not a facsimile, and a verifier that flags a font change will
// be turned off within a day.
export const VERIFY_QUESTION_PROMPT = `İki şəkil verilir:
(1) ORİJİNAL — kitabdan kəsilmiş sual (watermark ola bilər).
(2) YENİDƏN YARADILMIŞ — bizim sistemin həmin sualdan çıxardığı məlumatla çəkdiyi versiya.

Vəzifən: yenidən yaradılmış versiya orijinal sualı DÜZGÜN təkrarlayırmı?

ƏVVƏLCƏ fərqləri sadala, SONRA qərar ver. Əvvəlcə "uyğundur" deyib sonra fərq axtarma.

FƏRQ SAYILMAYAN (bunları HEÇ VAXT bildirmə):
- şrift, hərf ölçüsü, sətir aralığı, boşluqlar, rəng tonu, ümumi tərtibat;
- watermark-ın olmaması (onu qəsdən atırıq);
- fiqurun bir az fərqli ölçüdə və ya mövqedə çəkilməsi;
- $...$ içindəki eyni riyaziyyatın fərqli, amma ekvivalent yazılışı (0,5 = 0.5).

FƏRQ SAYILAN (hər birini ayrıca bildir):
- stem-də hər hansı RƏQƏM, hərf, ad və ya simvolun fərqli olması;
- şərtlərdən birinin buraxılması və ya əlavə edilməsi;
- variantların sayının fərqli olması, sırasının dəyişməsi, birinin boş qalması;
- hər hansı variantın MƏZMUNUNUN fərqli olması;
- fiqurun struktur olaraq fərqli olması: əskik/artıq nöqtə, xətt, parça;
- fiqurdakı İŞARƏLƏRİN əskik olması və ya səhv yerdə olması — bərabərlik cizgiləri,
  paralellik oxları, düz bucaq kvadratı, bərabər bucaq qövsləri;
- sualın SORUŞDUĞU kəmiyyətin (adətən α) yenidən yaradılmış fiqurda ümumiyyətlə
  işarələnməməsi — bu, sualı həll edilməz edir və mütləq bildirilməlidir;
- orijinalda olan mətnin/fiqurun tamamilə itməsi.

FİQURU ADDIM-ADDIM YOXLA (fərqi "görməyə" güvənmə, SAY):
1. Orijinaldakı bütün xətt/parça/şüaları say. Yenidən yaradılmışda neçədir? Say fərqlidirsə, hansı əskikdir?
2. Orijinaldakı bütün işarələri say — qövslər, bərabərlik cizgiləri, paralellik oxları,
   düz bucaq kvadratları. Hər birini yenidən yaradılmışda tap. Tapa bilmirsənsə, o fərqdir.
3. Sualın soruşduğu kəmiyyət (α və s.) orijinalda harada işarələnib? Yenidən yaradılmışda
   həmin yerdə varmı?

severity — bunu özün qiymətləndirmə, qaydaya əməl et:
- FİQURDA hər hansı əskik və ya artıq xətt, parça, şüa, bucaq və ya işarə → HƏMİŞƏ "critical",
  hətta sualı yenə də həll etmək mümkün görünsə belə. Fiqur məlumatdır: orada nə itibsə,
  bizim çıxardığımız məlumatdan itib, və bunu yalnız insan yoxlaya bilər.
- stem-də və ya variantlarda rəqəm/məzmun fərqi → "critical".
- yalnız yazılış tərzi ilə bağlı, mənanı dəyişməyən xırdalıq → "minor".

confidence: öz MÜQAYİSƏNƏ nə qədər əminsən (0-1), sualın çətinliyi deyil.
Şübhə varsa, fərqi BİLDİR və confidence-i aşağı sal — buraxılmış fərq yanlış xəbərdarlıqdan bahalıdır.`

/**
 * Every prompt whose text reaches a model and whose change must invalidate the
 * cache. A prompt missing from this list can be edited without moving the
 * fingerprint, and the next run replays the OLD prompt's answers under the new
 * text while reporting a cache hit — so `eval/suites/prompts.ts` asserts the
 * list against the module's own exports rather than trusting this line.
 */
export const FINGERPRINTED_PROMPTS = [
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  VERIFY_QUESTION_PROMPT,
]

/**
 * A fingerprint of every prompt text sent to the model, extract and verify
 * alike.
 *
 * PROMPT_VERSION is a human decision, and humans forget. Editing a rule without
 * bumping it makes `ops_cache` replay the answer the OLD prompt gave — and the
 * run reports a cache hit and reads as a success. That happened the first time
 * a rule here was tuned: the tuning was measured against its own pre-tuning
 * output, and the only clue was the word "cache" in a log line.
 *
 * So the cache key carries this rather than trusting the number. The version
 * still stamps rows, which is what it is good at — a person reading a row wants
 * to know which generation produced it. The fingerprint decides what may be
 * REPLAYED, which is what a machine is good at. A forgotten bump now costs
 * traceability and never correctness.
 *
 * djb2: this salts a cache key, it is not a security boundary.
 */
export function promptFingerprint(): string {
  const source = FINGERPRINTED_PROMPTS.join('\u0000')
  let hash = 5381
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
