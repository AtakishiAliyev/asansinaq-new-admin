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

3) Şaquli çarpma, gizli rəqəmlər (•) — NƏTİCƏ SƏTRİNİ MÜTLƏQ ver:
{"kind":"vertical_arithmetic","vertical":{"rows":[{"tex":"••••"},{"tex":"36","op":"×"},{"tex":"•••••"},{"tex":"9762","op":"+","indent":1}],"hline_after":[1,3],"result_tex":"••••••"}}

4) Funksiya qrafiki (parabola, işarəli nöqtə + qırıq bələdçi):
{"kind":"function_graph","panels":[{"x_min":-4,"x_max":6,"y_min":-2.5,"y_max":3.5,"grid":"none",
  "x_ticks":[{"at":-2,"tex":"-2"},{"at":4,"tex":"4"}],"y_ticks":[{"at":2,"tex":"2"}],
  "curves":[{"id":"g","color":"primary","curve_type":"expr","expr":"2-(2/9)*(x-1)^2","domain":[-3.2,5.2],"label_tex":"g(x)"}],
  "marks":[{"x":1,"y":2,"style":"dot"}],
  "guides":[{"from":{"x":1,"y":0},"to":{"x":1,"y":2}}]}]}
`
