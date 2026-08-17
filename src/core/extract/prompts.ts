// Bump on ANY change to prompts/schemas below: it versions cache keys and
// is stamped onto structured rows so a prompt regression can be traced back
// to the questions it produced.
export const PROMPT_VERSION = 1

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
7. Variantın MƏZMUNU şəkildirsə (fiqur, qrafik, forma): tex VERMƏ — is_image=true qoy və həmin variantın məzmun qutusunu box=[ymin,xmin,ymax,xmax] (0–1000 normallaşdırılmış) qaytar. Qutuya variant hərfi ("A)") DAXİL OLMASIN, yalnız fiqur. Mətnli variant üçün is_image və box vermə.
8. difficulty: sualın YÖS imtahanı kontekstində çətinliyini 1–5 arası qiymətləndir (1=çox asan, 3=orta, 5=çox çətin).`

// Rules 9-11: the declarative FigSpec instructions — only for the DSL lanes.
const SYSTEM_FIGURE_RULES = `9. Fiqurlar: deklarativ spec ver, şəkil çəkmə.
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
10. TÜRK BÖLMƏ SXEMİ (şaquli xətli bölmə) — kind="division_scheme", KƏSR DEYİL:
   dividend_tex = xəttin SOLUNDAKI yuxarı ifadə (bölünən);
   divisor_tex = xəttin SAĞINDAKI yuxarı ifadə (bölən);
   quotient_tex = bölənin ALTINDAKI ifadə (qismət, üfüqi xəttdən sonra);
   remainder_tex = bölünənin altındakı çıxma addımından qalan ƏN AŞAĞI ifadə (qalıq).
   Nümunə: A│B sxemi, B-nin altında 4, A-nın altında 5 → {"dividend_tex":"A","divisor_tex":"B","quotient_tex":"4","remainder_tex":"5"}.
11. ŞAQULİ HESAB (alt-alta çarpma/toplama) — kind="vertical_arithmetic":
   rows = çap olunduğu sıra ilə YUXARIDAN AŞAĞI hər sətir; sətrin solunda operator varsa həmin sətrə op yaz ("×" vuruq sətrində, "+" sürüşdürülmüş hissə-hasil sətrində);
   gizli rəqəmlər üçün hər nöqtə əvəzinə "•" simvolu (məs. "••••");
   sola sürüşmüş sətirlər üçün indent (rəqəm mövqeyi sayı);
   üfüqi xətlər hline_after-də (0-əsaslı sətir indeksindən SONRA);
   ən aşağı nəticə sətri result_tex.
   Nümunə: ••••×36, altda xətt, •••••, +9762 (1 sola), xətt, •••••• →
   {"rows":[{"tex":"••••"},{"tex":"36","op":"×"},{"tex":"•••••"},{"tex":"9762","op":"+","indent":1}],"hline_after":[1,3],"result_tex":"••••••"}.`

const SYSTEM_TAIL = `12. Stem-də çap olunmuş hər şərt AYRICA sətirdə olsun — sətirlər arasında \\n istifadə et, şərtləri bir cümləyə yığma.
    VACİB: \\n HEÇVAXT $...$ math blokunun İÇİNDƏ olmasın — hər sətri ÖZ $...$ blokuna sal:
    DÜZGÜN: "$f(a+b)=f(a)+f(b)$\\n$f(7)=?$"  SƏHV: "$f(a+b)=f(a)+f(b)\\nf(7)=?$"`

// The raster lane's replacement for rules 9-11: the figure arrives from the
// image model separately, so the vision model must NOT emit a figure spec.
const SYSTEM_NO_FIGURE_RULE = `9. FİQURU ÇIXARMA — figures sahəsini BOŞ saxla; fiqur ayrıca sistem tərəfindən əlavə olunur.`

/** Full system prompt for the DSL/plain lanes (declarative figure specs). */
export const EXTRACT_SYSTEM = [SYSTEM_HEAD, SYSTEM_FIGURE_RULES, SYSTEM_TAIL].join('\n')

/** System prompt for the raster lane (image model draws the figure). */
export const EXTRACT_SYSTEM_RASTER = [SYSTEM_HEAD, SYSTEM_NO_FIGURE_RULE, SYSTEM_TAIL].join('\n')

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

export const SOLVE_PROMPT = `Bu çoxvariantlı sualı həll et və YALNIZ düzgün variantın hərfini (A–E) qaytar.`

export const SUGGEST_CATEGORY_PROMPT = `Aşağıda bir imtahan sualı və mövcud kateqoriya siyahısı verilir.
Sualın mövzusuna ƏN UYĞUN və ƏN SPESİFİK kateqoriyanın id-sini seç.
YALNIZ verilmiş siyahıdan seç — yeni kateqoriya uydurma. Heç biri uyğun deyilsə category_id=null qaytar.
confidence: seçiminə əminliyin (0–1).`

export const PARSE_ANSWER_KEY_PROMPT = `Bu, imtahan kitabının CAVAB AÇARI səhifəsidir. Bütün cavabları çıxar.

Qaydalar:
- Hər giriş: sual nömrəsi (q_no) + cavab hərfi (A–E).
- Səhifədə "Test N" / "N. Deneme" başlıqları varsa, ALTINDAKI girişlərə həmin test_no-nu yaz; başlıq yoxdursa test_no vermə.
- Cədvəl sütunlarla düzülə bilər (1–20 solda, 21–40 sağda) — HAMISINI oxu, sütun sırası ilə.
- Boş və ya oxunmayan xanaları BURAXıб davam et — uydurma.
- Səhifə nömrəsini, başlıqları, reklamı sual sayma.`
