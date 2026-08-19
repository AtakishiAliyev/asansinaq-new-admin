// Bump on ANY change to prompts/schemas below: it versions cache keys and
// is stamped onto structured rows so a prompt regression can be traced back
// to the questions it produced.
export const PROMPT_VERSION = 5

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
   - ŞƏKİL variantı (fiqur, qrafik, forma, rəngli xanalar): is_image=true VƏ box=[ymin,xmin,ymax,xmax] (0–1000 normallaşdırılmış) — HƏR İKİSİ məcburidir. box olmasa həmin variant tamamilə itir. Qutuya variant hərfi ("A)") daxil olmasın, yalnız fiqurun özü.
   Şəkil variantında tex sahəsini sadəcə boş burax — ora nə şəklin içindəki rəqəmləri, nə izahat, nə də öz mülahizəni yaz.
   Bir variant şəkildirsə, çox güman BEŞİ də şəkildir — hamısına ayrı-ayrı box ver, heç birini ötürmə.
8. difficulty: sualın YÖS imtahanı kontekstində çətinliyini 1–5 arası qiymətləndir (1=çox asan, 3=orta, 5=çox çətin).
9. confidence: ÇƏTİNLİK DEYİL — bu, sənin OXUNUŞUNUN dəqiqliyidir: 1.0 = hər simvolu aydın oxudum, şübhəm yoxdur; 0.85 = oxudum, amma bir-iki simvolda (indeks, üst işarə, kiçik rəqəm) tərəddüd var; 0.5 = xeyli hissəni təxmin etdim. 0.85-dən aşağı hər şey insan yoxlamasına göndərilir, ona görə dürüst qiymətləndir — yüksək rəqəm sənə fayda vermir.
10. Səhifədə çəkilmiş şəkil (diaqram, qrafik, cədvəl, sxem) varsa figure_box=[ymin,xmin,ymax,xmax] (0–1000) ver — YALNIZ rəsmin ətrafı. Sual mətni, "⇒ ... = ?" sətri və cavab variantları qutuya DAXİL OLMAMALIDIR. Şəkil yoxdursa figure_box vermə.
11. Stem-də çap olunmuş hər şərt AYRICA sətirdə olsun — sətirlər arasında \\n istifadə et, şərtləri bir cümləyə yığma.
    VACİB: \\n HEÇVAXT $...$ math blokunun İÇİNDƏ olmasın — hər sətri ÖZ $...$ blokuna sal:
    DÜZGÜN: "$f(a+b)=f(a)+f(b)$\\n$f(7)=?$"  SƏHV: "$f(a+b)=f(a)+f(b)\\nf(7)=?$"`

// Rules 9-11: the declarative FigSpec instructions — only for the DSL lanes.
const SYSTEM_FIGURE_RULES = `12. Fiqurlar: deklarativ spec ver, şəkil çəkmə.
   - Ox etiketlərini (simvolik olsa belə: 2a, -a/2), hər işarəli nöqtəni, qırıq bələdçi xətti, əyri rəngini və adını şəkildən oxu.
   - Sərbəst dalğalı əyrilər üçün curve_type="spline" və hər işarəli/ekstremal nöqtəni points-ə daxil et; tanınan ailə (düz xətt, parabola) üçün curve_type="expr".
   - Venn/çoxluq diaqramı: sual şəkilə istinad edirsə ("Yukarıdaki Venn şeması", "Şekilde...") figures MÜTLƏQ doldurulmalıdır, boş buraxma. BİR sualda BİR venn fiquru — eyni diaqramı təkrar vermə.
     venn_shapes: hər çoxluq bir forma (ellipse/circle/triangle/rect), kətan ~300x230 px, tipik iki dairə: cx=115 və cx=185, cy=115, r=70.
       id = şəkildəki AD (K, L, M, A... Roma rəqəmi də ola bilər: I, II, III, IV); label = eyni ad.
       color: şəkildəki rəngə uyğun token seç — qırmızı→primary, mavi/göy→secondary, yaşıl→guide, qara→ink, boz→muted.
       Düzbucaqlı çoxluq (şəkildəki M çərçivəsi kimi): {"id":"M","label":"M","shape":"rect","x":80,"y":95,"w":150,"h":45}.
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
14. ŞAQULİ HESAB (alt-alta çarpma/toplama) — kind="vertical_arithmetic":
   rows = çap olunduğu sıra ilə YUXARIDAN AŞAĞI hər sətir; sətrin solunda operator varsa həmin sətrə op yaz ("×" vuruq sətrində, "+" sürüşdürülmüş hissə-hasil sətrində);
   gizli rəqəmlər üçün hər nöqtə əvəzinə "•" simvolu (məs. "••••");
   sola sürüşmüş sətirlər üçün indent (rəqəm mövqeyi sayı);
   üfüqi xətlər hline_after-də (0-əsaslı sətir indeksindən SONRA);
   ən aşağı nəticə sətri result_tex.
   Nümunə: ••••×36, altda xətt, •••••, +9762 (1 sola), xətt, •••••• →
   {"rows":[{"tex":"••••"},{"tex":"36","op":"×"},{"tex":"•••••"},{"tex":"9762","op":"+","indent":1}],"hline_after":[1,3],"result_tex":"••••••"}.
15. YUXARIDAKI NÖVLƏRİN HEÇ BİRİNƏ UYMAYAN FİQUR — kind="raw_svg", raw_svg sahəsinə SVG yaz.
   Həndəsə şəkilləri bura düşür: bucaqlı şüalar, üçbucaq/dördbucaq qurumları, işarələnmiş bucaqlar, paralel oxlar, adlandırılmış nöqtələr.
   Sual şəklə istinad edirsə və uyğun struktur növ yoxdursa, figures-i BOŞ BURAXMA — raw_svg ver.
   Qaydalar: viewBox MÜTLƏQ olsun (məs. viewBox="0 0 400 300"); yalnız path, line, polyline, polygon, rect, circle, ellipse, text, tspan, g, defs, marker;
   stroke="currentColor" fill="none" istifadə et ki, şəkil hər fonda oxunsun; nöqtə adlarını (A, B, C, D, E, F) və dərəcələri (30°, 50°, 130°) text ilə yaz;
   ox ucu lazımdırsa defs içində marker təyin et və marker-end="url(#ox)" ver.
   QADAĞAN: script, style, image, use, foreignObject, xarici href/xlink, on* atributları — bunlar silinir və fiqur rədd edilə bilər.
   Ölçüləri şəkildən oxu, təxmin etmə: bucaq böyüklükləri və nöqtələrin sırası orijinalla eyni olmalıdır.
   QISA SAXLA: SVG 3000 simvoldan çox olmasın. Sadə primitivlər işlət (line, polyline, circle, text), uzun path əyriləri və artıq dəqiqlik vermə —
   koordinatları tam ədəd yaz. Məqsəd şəklin OXUNAN və ÖLÇÜ-DOĞRU təkrarıdır, bədii dəqiqlik deyil.`


// The raster lane's replacement for rules 9-11: the figure arrives from the
// image model separately, so the vision model must NOT emit a figure spec.
const SYSTEM_NO_FIGURE_RULE = `12. SUALIN fiqurunu ÇIXARMA — figures sahəsini BOŞ saxla; sualın fiquru ayrıca sistem tərəfindən çəkilir.
    DİQQƏT: bu yalnız sualın öz fiquruna aiddir. 7-ci qayda — ŞƏKİLLİ VARİANTLAR — tam qüvvədədir:
    variantlar şəkildirsə, hər biri üçün is_image=true VƏ box mütləq verilməlidir. Onlarsız variantlar itir.`

/** Full system prompt for the DSL/plain lanes (declarative figure specs). */
export const EXTRACT_SYSTEM = [SYSTEM_HEAD, SYSTEM_FIGURE_RULES].join('\n')

/** System prompt for the raster lane (image model draws the figure). */
export const EXTRACT_SYSTEM_RASTER = [SYSTEM_HEAD, SYSTEM_NO_FIGURE_RULE].join('\n')

// Sent to the OpenAI images/edits endpoint with the reference image. Works
// for whole-question figures AND for a pre-cropped single option's figure.
export const REDRAW_PROMPT = `Redraw ONLY the diagram from the provided image as a clean vector-style illustration.

Requirements:
- Preserve the geometry exactly.
- Preserve all shape positions, intersections, proportions and spacing.
- Preserve every label, number and symbol exactly, in its exact region.
- Preserve all colors and line thickness.
- Do not add, remove or reposition any element.
- Use a pure white background.
- Remove the surrounding question text, answer choices, borders and any watermark.
- Produce only the reconstructed diagram with sharp, crisp edges.`

export const COMPARE_FIGURES_PROMPT = `İki şəkil verilir: (1) ORİJİNAL fiqur (watermark ola bilər), (2) YENİDƏN YARADILMIŞ fiqur.
Bunlar EYNİ fiqurdurmu? Topoloji/semantik müqayisə et, piksel dəqiqliyi YOX:
- Eyni formalar, eyni kəsişmə/yerləşmə strukturu?
- Bütün etiketlər, rəqəmlər, simvollar eynidirmi və DÜZGÜN bölgədədirmi?
- Ştrixlənmiş/rəngli bölgə eyni yerdədirmi?
Fərq varsa differences-də konkret yaz (məs. "b etiketi ellipsdən kənara sürüşüb", "3 rəqəmi çatışmır"). Watermark və kiçik üslub fərqlərini SAYMA.`

export const SUGGEST_CATEGORY_PROMPT = `Aşağıda bir imtahan sualı və mövcud kateqoriya siyahısı verilir.
Sualın mövzusuna ƏN UYĞUN və ƏN SPESİFİK kateqoriyanın id-sini seç.
YALNIZ verilmiş siyahıdan seç — yeni kateqoriya uydurma. Heç biri uyğun deyilsə category_id=null qaytar.
confidence: seçiminə əminliyin (0–1).`

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

export const OPTION_BOXES_PROMPT = `Bu şəkildə bir imtahan sualı və onun A–E cavab variantları var. Variantların məzmunu ŞƏKİLDİR (fiqur, naxış, forma).
Vəzifən: hər variantın ŞƏKLİNİN yerini tapmaq — başqa heç nə.

Qaydalar:
- Hər variant üçün box = [ymin, xmin, ymax, xmax], 0–1000 normallaşdırılmış (0 = yuxarı/sol).
- Qutuya variant hərfi ("A)", "B)") DAXİL OLMASIN — yalnız fiqurun özü.
- Variantlar bir sırada, iki sırada və ya şaquli düzülə bilər — düzülüşdən asılı olmayaraq beşini də tap.
- Sualın öz fiqurunu (yuxarıdakı böyük şəkil) variant sanma.
- BEŞ variantın hamısını qaytar: A, B, C, D, E.`
