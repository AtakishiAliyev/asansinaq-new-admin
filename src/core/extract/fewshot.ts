// Golden few-shot examples for the DSL figure path. Each pairs a short
// description with the EXACT wire-schema JSON the model should emit. These
// target the recurring failure modes we hit: venn region labels, division-scheme
// field semantics, vertical-arithmetic result rows, function-graph specs.
// Appended to the Gemini system prompt when a figure is expected.

export const FEWSHOT_FIGURES = `
NÜMUNƏLƏR (figures massivinə bu formada yaz):

1) İki dairəli Venn, bölgələrdə elementlər, kəsişmə ştrixli:
{"kind":"venn","venn_width":300,"venn_height":220,"venn_shapes":[
  {"id":"A","label":"A","color":"secondary","shape":"circle","cx":115,"cy":115,"r":68},
  {"id":"B","label":"B","color":"guide","shape":"circle","cx":185,"cy":115,"r":68}],
 "shaded":["A∩B"],
 "region_labels":[{"expr":"A-B","tex":"2"},{"expr":"A∩B","tex":"1,\\\\ 2,\\\\ a"},{"expr":"B-A","tex":"3"},{"expr":"(A∪B)'","tex":"e,f"}],
 "universe_label":"E"}

2) Türk bölmə sxemi (A│B, B altında qismət 4, A altında qalıq 5) — KƏSR DEYİL:
{"kind":"division_scheme","division":{"style":"arithmetic","dividend_tex":"A","divisor_tex":"B","quotient_tex":"4","remainder_tex":"5"}}

2b) BÖLMƏ SXEMİNDƏ DÖRD ROL — ifadəli xanalarda rollar QARIŞIR.
Sxem dörd rolu POZİSİYA ilə ayırır: sol-yuxarı bölünən, sağ-yuxarı bölən,
sağ-aşağı bölüm, sol-aşağı qalıq. Hər rol ÖZ xanasına.
SƏHV: {"dividend_tex":"A","divisor_tex":"n^2/n","quotient_tex":"","remainder_tex":"64"}
  — "n^2/n" iki roldur bir xanada, bölüm isə boş qalıb.
DÜZGÜN (A ÷ n = n², qalıq 64):
{"kind":"division_scheme","division":{"style":"arithmetic","dividend_tex":"A","divisor_tex":"n","quotient_tex":"n^2","remainder_tex":"64"}}
Xanada / və ya \\frac YAZMA — bölmə işarəsi sxemin ÖZÜdür.

2c) YANAŞI İKİ BÖLMƏ SXEMİ — biri sualın şərti, o biri sualı; İKİSİNİ də ver
və layout_direction="row" qoy ki, yan-yana çəkilsin:
{"kind":"division_scheme","division":{"style":"arithmetic","dividend_tex":"K","divisor_tex":"7","quotient_tex":"M","remainder_tex":"3"}}
{"kind":"division_scheme","division":{"style":"arithmetic","dividend_tex":"K+4","divisor_tex":"M+1","quotient_tex":"7","remainder_tex":"L"}}

3) Şaquli çarpma, gizli rəqəmlər (•) — NƏTİCƏ SƏTRİNİ MÜTLƏQ ver:
{"kind":"vertical_arithmetic","vertical":{"rows":[{"tex":"••••"},{"tex":"36","op":"×"},{"tex":"•••••"},{"tex":"9762","op":"+","indent":1}],"hline_after":[1,3],"result_tex":"••••••"}}

4) ŞƏKİLLİ VARİANT SƏTRİ (IQ tipli sual) — QUTULAR SƏXAVƏTLİ olmalıdır.
Səhifə: yuxarıda "A = ? ; B = ? ; C = ?" sətri, ONUN ALTINDA A)–E) variantları,
hər variant üç rəngli dairədən ibarətdir. Variantlar 380–980 arasında (0–1000 şəbəkəsi)
şaquli düzülüb, hər biri ~120 vahid hündürlükdə, dairələr 150–430 arasında yerləşir.
DÜZGÜN (hər qutu öz sətrinin BÜTÜN hündürlüyünü tutur, növbəti variantın başlanğıcına qədər):
{"label":"A","is_image":true,"box":[380,140,500,440]}
{"label":"B","is_image":true,"box":[500,140,620,440]}
{"label":"C","is_image":true,"box":[620,140,740,440]}
{"label":"D","is_image":true,"box":[740,140,860,440]}
{"label":"E","is_image":true,"box":[860,140,980,440]}
SƏHV: [370,145,415,430] — bu qutu "A = ? ; B = ? ; C = ?" başlıq sətrinin üstünə düşür
və cəmi 45 vahid hündürlükdədir; dairələr qutudan aşağıda qalır, variant boş çıxır.

5) Funksiya qrafiki (parabola, işarəli nöqtə + qırıq bələdçi):
{"kind":"function_graph","panels":[{"x_min":-4,"x_max":6,"y_min":-2.5,"y_max":3.5,"grid":"none",
  "x_ticks":[{"at":-2,"tex":"-2"},{"at":4,"tex":"4"}],"y_ticks":[{"at":2,"tex":"2"}],
  "curves":[{"id":"g","color":"primary","curve_type":"expr","expr":"2-(2/9)*(x-1)^2","domain":[-3.2,5.2],"label_tex":"g(x)"}],
  "marks":[{"x":1,"y":2,"style":"dot"}],
  "guides":[{"from":{"x":1,"y":0},"to":{"x":1,"y":2}}]}]}
`
