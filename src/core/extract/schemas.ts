// Gemini responseSchemas for every question-ops op. Flat OpenAPI-subset
// shapes (no oneOf, no tuples — Gemini's responseSchema limitation), ported
// from the exam MVP and extended with difficulty and image-option boxes.
// Shared by the Edge Function and the eval harness.

const T = {
  str: { type: 'string' },
  num: { type: 'number' },
  bool: { type: 'boolean' },
} as const

const point = {
  type: 'object',
  properties: { x: T.num, y: T.num },
  required: ['x', 'y'],
}

const tick = {
  type: 'object',
  properties: { at: T.num, tex: { type: 'string', description: 'label TeX, may be symbolic e.g. 2a, \\frac{-a}{2}' } },
  required: ['at', 'tex'],
}

const figureObject = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['function_graph', 'venn', 'division_scheme', 'vertical_arithmetic', 'table', 'number_line'],
    },
    // function_graph
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x_min: T.num,
          x_max: T.num,
          y_min: T.num,
          y_max: T.num,
          grid: { type: 'string', enum: ['none', 'dotted', 'solid'] },
          x_ticks: { type: 'array', items: tick },
          y_ticks: { type: 'array', items: tick },
          curves: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: T.str,
                color: { type: 'string', enum: ['primary', 'secondary', 'guide', 'ink', 'muted'] },
                label_tex: T.str,
                curve_type: { type: 'string', enum: ['expr', 'spline', 'polyline'] },
                expr: { type: 'string', description: 'when curve_type=expr; math in terms of x' },
                domain: { type: 'array', items: T.num, description: '[min,max] for expr' },
                points: { type: 'array', items: point, description: 'for spline/polyline; include every marked/extremal point' },
              },
              required: ['id', 'color', 'curve_type'],
            },
          },
          marks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { x: T.num, y: T.num, style: { type: 'string', enum: ['dot', 'open'] }, label_tex: T.str },
              required: ['x', 'y', 'style'],
            },
          },
          guides: {
            type: 'array',
            items: {
              type: 'object',
              properties: { from: point, to: point },
              required: ['from', 'to'],
            },
          },
        },
        required: ['x_min', 'x_max', 'y_min', 'y_max'],
      },
    },
    // venn
    venn_shapes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: T.str,
          label: T.str,
          color: { type: 'string', enum: ['primary', 'secondary', 'guide', 'ink', 'muted'] },
          shape: { type: 'string', enum: ['ellipse', 'circle', 'triangle', 'rect'] },
          cx: T.num,
          cy: T.num,
          rx: T.num,
          ry: T.num,
          r: T.num,
          rotate: T.num,
          x: T.num,
          y: T.num,
          w: T.num,
          h: T.num,
          points: { type: 'array', items: point, description: 'for triangle: 3 vertices' },
        },
        required: ['id', 'label', 'shape'],
      },
    },
    venn_width: T.num,
    venn_height: T.num,
    universe_label: { type: 'string', description: 'label of the enclosing universe rectangle if drawn (U, E, ...)' },
    shaded: {
      type: 'array',
      items: T.str,
      description: 'set-algebra expressions of the shaded regions, e.g. "(A∩B)-C", "A∪B\'"',
    },
    shade_color: { type: 'string', description: 'hex color of the shaded fill (yellow/red per the figure)' },
    region_labels: {
      type: 'array',
      description: 'content printed INSIDE a region: counts or element lists, e.g. {expr:"A-B",tex:"2"}, {expr:"A∩B",tex:"1, 2, a"}, {expr:"(A∪B)\'",tex:"e,f"}',
      items: {
        type: 'object',
        properties: {
          expr: { type: 'string', description: 'set-algebra expression naming the region' },
          tex: { type: 'string', description: 'the printed content, WITHOUT $ delimiters' },
        },
        required: ['expr', 'tex'],
      },
    },
    // division_scheme
    division: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['arithmetic', 'polynomial'] },
        dividend_tex: T.str,
        divisor_tex: T.str,
        quotient_tex: T.str,
        remainder_tex: T.str,
      },
    },
    // vertical_arithmetic
    vertical: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tex: { type: 'string', description: 'row content exactly as printed; masked digits as • bullets' },
              op: { type: 'string', enum: ['×', '+', '−'], description: 'operator printed at the left of THIS row, if any' },
              indent: { type: 'number', description: 'left shift in digit positions (partial products)' },
            },
            required: ['tex'],
          },
        },
        hline_after: { type: 'array', items: { type: 'integer' }, description: 'rule line after these row indexes (0-based)' },
        result_tex: { type: 'string', description: 'final row under the last rule' },
      },
    },
    // table
    table: {
      type: 'object',
      properties: {
        header_rows: T.num,
        header_cols: T.num,
        cells: { type: 'array', items: { type: 'array', items: T.str } },
      },
    },
    // number_line
    number_line: {
      type: 'object',
      properties: {
        min: T.num,
        max: T.num,
        ticks: { type: 'array', items: tick },
      },
    },
    note: T.str,
  },
  required: ['kind'],
}

export const extractResponseSchema = {
  type: 'object',
  properties: {
    number_seen: { type: 'integer', description: 'the printed question number in the image' },
    stem: { type: 'string', description: 'question text, Markdown with $...$ LaTeX; the ⇒ ... = ? line is part of the stem; do NOT include the leading number; do NOT solve' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
          tex: T.str,
          is_image: { type: 'boolean', description: 'true when the option content is a figure, not text' },
          box: {
            type: 'array',
            items: T.num,
            description: '[ymin,xmin,ymax,xmax] 0-1000 normalized box of an image option content (label letter excluded)',
          },
        },
        required: ['label'],
      },
    },
    figures: { type: 'array', items: figureObject },
    illegible: { type: 'boolean', description: 'true if any field is unreadable/overprinted — return empty rather than guessing' },
    clipped: { type: 'boolean' },
    foreign: { type: 'boolean', description: 'fragments of a neighbouring question visible in the crop' },
    confidence: { type: 'number' },
    difficulty: { type: 'integer', description: 'estimated difficulty 1-5 in the YÖS exam context' },
    warnings: { type: 'array', items: T.str },
  },
  required: ['number_seen', 'stem', 'options', 'illegible', 'confidence', 'difficulty'],
}

export const compareFiguresSchema = {
  type: 'object',
  properties: {
    match: {
      type: 'boolean',
      description: 'true if the two images show the SAME figure (same shapes, labels, values, topology)',
    },
    differences: {
      type: 'array',
      items: { type: 'string' },
      description: 'concrete differences if any',
    },
  },
  required: ['match'],
}


export const suggestCategorySchema = {
  type: 'object',
  properties: {
    category_id: { type: 'integer', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['confidence'],
}

export const parseAnswerKeySchema = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          test_no: { type: 'integer', description: 'test/deneme number from the section header, omit when none' },
          q_no: { type: 'integer' },
          answer: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
        },
        required: ['q_no', 'answer'],
      },
    },
  },
  required: ['entries'],
}
