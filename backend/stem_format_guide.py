"""
STEM canvas response format — training examples for LLM prompts.

The canvas renders proper tldraw shapes (not ASCII art), but every answer
must follow this STRUCTURE:

  1. explanation      — readable prose for the chat panel
  2. explanation_blocks — labeled comparison cards placed on canvas
  3. tests            — bullet list of skills tested
  4. diagram          — flowchart | graph | labeled_diagram JSON (when visual)
"""

STEM_RESPONSE_FORMAT = (
    "CANVAS RESPONSE FORMAT (always follow this structure):\n"
    "Return JSON with these fields:\n"
    '  "explanation" — 4-12 sentences for the chat panel (clear prose, LaTeX for math)\n'
    '  "explanation_blocks" — array of {"label":"...", "content":"..."} comparison cards\n'
    '  "tests" — array of strings listing what this exercise tests\n'
    '  "diagram" — flowchart/graph/labeled_diagram JSON, or null\n'
    '  "offer_visual" — true if a diagram would help and none was generated\n\n'
    "BLOCK RULES:\n"
    "- Use blocks for side-by-side comparisons (Degenerated vs Balanced, Dijkstra vs A*, etc.)\n"
    "- Each block label is a short heading (2-5 words). Content is 1-4 lines with key metrics.\n"
    "- Use \\n for line breaks inside content. Include complexity, heights, costs, or key facts.\n"
    "- Always end with tests: [\"Topic skill\", \"Reasoning skill\"] (2-4 items).\n\n"
    "NEVER return ASCII art or monospace diagrams in explanation text. "
    "Put visuals in the diagram JSON field — the app renders them as real canvas shapes.\n"
)

# ---------------------------------------------------------------------------
# Topic-specific format examples (structure only — diagram is real JSON)
# ---------------------------------------------------------------------------

BST_EXAMPLE = (
    "EXAMPLE — Binary Search Tree Degeneration:\n"
    "Prompt topic: show BST from inserting 1,2,3,4,5,6,7 vs 4,2,6,1,3,5,7\n"
    '{"explanation":"Inserting sorted keys into a BST creates a right-skewed chain (height n-1, '
    'search O(n)). A balanced insertion order keeps height O(log n).",'
    '"explanation_blocks":['
    '{"label":"Degenerated BST","content":"Insert order: 1,2,3,4,5,6,7\\nHeight = 6\\nSearch = O(n)"},'
    '{"label":"Balanced BST","content":"Insert order: 4,2,6,1,3,5,7\\nHeight = 2\\nSearch = O(log n)"}'
    '],'
    '"tests":["Tree generation","Complexity reasoning"],'
    '"diagram":{"type":"labeled_diagram","title":"BST Insertion Comparison",'
    '"nodes":['
    '{"id":"d1","label":"Degenerated: 1→2→3→7","row":0,"col":-1,"shape":"rectangle","color":"red"},'
    '{"id":"b1","label":"Balanced: root 4","row":0,"col":1,"shape":"ellipse","color":"green"},'
    '{"id":"b2","label":"Left: 2 (1,3)","row":1,"col":0,"shape":"rectangle","color":"blue"},'
    '{"id":"b3","label":"Right: 6 (5,7)","row":1,"col":2,"shape":"rectangle","color":"blue"}'
    '],"edges":[{"from":"b1","to":"b2","label":"left subtree"},{"from":"b1","to":"b3","label":"right subtree"}]},'
    '"offer_visual":false}\n'
)

HASH_TABLE_EXAMPLE = (
    "EXAMPLE — Hash Table Performance (load factor graph):\n"
    '{"explanation":"As load factor α approaches 1, open addressing suffers collision chains '
    'that explode lookup cost, while chaining grows more gradually.",'
    '"explanation_blocks":['
    '{"label":"Open Addressing","content":"When α → 1:\\ncollisions explode\\nLookup cost rises sharply"},'
    '{"label":"Chaining","content":"When α → 1:\\ngrows more gradually\\nLookup stays manageable"}'
    '],'
    '"tests":["Data structure knowledge","Graph generation"],'
    '"diagram":{"type":"graph","title":"Hash Table Lookup Cost","subtitle":"Open addressing vs chaining",'
    '"functions":[{"expr":"1/(1-x)","label":"Open Addressing","color":"red"},'
    '{"expr":"1+x","label":"Chaining","color":"blue"}],'
    '"axisLabels":{"x":"Load Factor α","y":"Lookup Cost"},'
    '"xMin":0,"xMax":0.95,"yMin":0,"yMax":8},'
    '"offer_visual":false}\n'
)

ASTAR_DIJKSTRA_EXAMPLE = (
    "EXAMPLE — A* vs Dijkstra:\n"
    '{"explanation":"Dijkstra explores uniformly in all directions. A* uses a heuristic to focus '
    'expansion toward the goal, visiting far fewer nodes on the same grid.",'
    '"explanation_blocks":['
    '{"label":"Dijkstra","content":"Explores everywhere equally.\\nNo heuristic guidance."},'
    '{"label":"A*","content":"Uses heuristic h(n).\\nExplores mostly toward goal."}'
    '],'
    '"tests":["Graph search understanding","Spatial visualization"],'
    '"diagram":{"type":"flowchart","title":"A* Search Loop",'
    '"nodes":['
    '{"id":"n1","label":"Start: open set {S}","row":0,"col":0,"shape":"rectangle","color":"black","role":"start"},'
    '{"id":"n2","label":"Pick min f(n)=g+h","row":1,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n3","label":"n == goal?","row":2,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n4","label":"Reconstruct path","row":3,"col":-1,"shape":"ellipse","color":"orange","role":"outcome"},'
    '{"id":"n5","label":"Expand neighbors","row":3,"col":1,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n6","label":"Update g, f scores","row":4,"col":1,"shape":"rectangle","color":"green","role":"process"}'
    '],'
    '"edges":[{"from":"n1","to":"n2","label":"init"},{"from":"n2","to":"n3","label":""},'
    '{"from":"n3","to":"n4","label":"yes"},{"from":"n3","to":"n5","label":"no"},'
    '{"from":"n5","to":"n6","label":""},{"from":"n6","to":"n2","label":"repeat"}]},'
    '"offer_visual":false}\n'
)

CPU_SCHEDULING_EXAMPLE = (
    "EXAMPLE — CPU Scheduling (FCFS, SJF, Round Robin):\n"
    "Given: P1=10ms, P2=4ms, P3=2ms\n"
    '{"explanation":"FCFS runs jobs in arrival order (high waiting time). SJF minimizes average '
    'wait by running shortest job first. Round Robin time-slices with quantum q=2.",'
    '"explanation_blocks":['
    '{"label":"FCFS","content":"Order: P1→P2→P3\\nAvg wait = (0+10+14)/3 = 8ms"},'
    '{"label":"SJF","content":"Order: P3→P2→P1\\nAvg wait = (0+2+6)/3 = 2.67ms"},'
    '{"label":"Round Robin (q=2)","content":"|P1|P2|P3|P1|P2|P1|...\\nFair but higher avg wait"}'
    '],'
    '"tests":["Simulation","Visualization"],'
    '"diagram":{"type":"flowchart","title":"SJF Scheduling",'
    '"nodes":['
    '{"id":"n1","label":"Jobs in ready queue","row":0,"col":0,"shape":"ellipse","color":"blue","role":"input"},'
    '{"id":"n2","label":"Pick shortest burst","row":1,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n3","label":"Run to completion","row":2,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n4","label":"Queue empty?","row":3,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n5","label":"Done","row":4,"col":0,"shape":"ellipse","color":"orange","role":"outcome"}'
    '],'
    '"edges":[{"from":"n1","to":"n2","label":"init"},{"from":"n2","to":"n3","label":""},'
    '{"from":"n3","to":"n4","label":""},{"from":"n4","to":"n2","label":"no"},{"from":"n4","to":"n5","label":"yes"}]},'
    '"offer_visual":false}\n'
)

TCP_FLOWCHART_EXAMPLE = (
    "EXAMPLE — TCP Three-Way Handshake (vertical decision flowchart):\n"
    '{"explanation":"TCP establishes a reliable connection via SYN, SYN-ACK, ACK. '
    'Lost packets trigger retransmission.",'
    '"explanation_blocks":['
    '{"label":"Handshake","content":"SYN → SYN-ACK → ACK\\nConnection established"},'
    '{"label":"Reliability","content":"Packet lost? → Retransmit\\nOtherwise continue data transfer"}'
    '],'
    '"tests":["Networking","Decision flow"],'
    '"diagram":{"type":"flowchart","title":"TCP Connection Setup",'
    '"nodes":['
    '{"id":"n1","label":"Start","row":0,"col":0,"shape":"rectangle","color":"black","role":"start"},'
    '{"id":"n2","label":"Send SYN","row":1,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n3","label":"Receive SYN-ACK?","row":2,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n4","label":"Retransmit SYN","row":3,"col":1,"shape":"rectangle","color":"red","role":"process"},'
    '{"id":"n5","label":"Send ACK","row":3,"col":-1,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n6","label":"Connection Established","row":4,"col":-1,"shape":"ellipse","color":"orange","role":"outcome"},'
    '{"id":"n7","label":"Data Transfer","row":5,"col":-1,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n8","label":"Packet Lost?","row":6,"col":-1,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n9","label":"Retransmit","row":7,"col":0,"shape":"rectangle","color":"red","role":"process"},'
    '{"id":"n10","label":"Send FIN","row":7,"col":-2,"shape":"rectangle","color":"green","role":"process"}'
    '],'
    '"edges":[{"from":"n1","to":"n2","label":""},{"from":"n2","to":"n3","label":""},'
    '{"from":"n3","to":"n4","label":"no"},{"from":"n3","to":"n5","label":"yes"},'
    '{"from":"n5","to":"n6","label":""},{"from":"n6","to":"n7","label":""},'
    '{"from":"n7","to":"n8","label":""},{"from":"n8","to":"n9","label":"yes"},'
    '{"from":"n8","to":"n10","label":"no"},{"from":"n4","to":"n2","label":"retry"}]},'
    '"offer_visual":false}\n'
)

COMPILER_PIPELINE_EXAMPLE = (
    "EXAMPLE — Compiler Pipeline:\n"
    '{"explanation":"A compiler transforms source code through lexical analysis, parsing, semantic '
    'analysis, optimization, and code generation.",'
    '"explanation_blocks":['
    '{"label":"Lexical","content":"Converts text → tokens"},'
    '{"label":"Parser","content":"Checks grammar → parse tree"},'
    '{"label":"Semantic","content":"Checks meaning → typed IR"},'
    '{"label":"Optimizer","content":"Improves performance"},'
    '{"label":"Code Generator","content":"Emits machine code"}'
    '],'
    '"tests":["Multiple CS concepts","Decision flow"],'
    '"diagram":{"type":"flowchart","title":"Compiler Pipeline",'
    '"nodes":['
    '{"id":"n1","label":"Source Code","row":0,"col":0,"shape":"ellipse","color":"blue","role":"input"},'
    '{"id":"n2","label":"Lexical Analyzer","row":1,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n3","label":"Parser","row":2,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n4","label":"Parse Tree","row":3,"col":0,"shape":"rectangle","color":"violet","role":"formula"},'
    '{"id":"n5","label":"Semantic Analyzer","row":4,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n6","label":"Intermediate Code","row":5,"col":0,"shape":"rectangle","color":"violet","role":"formula"},'
    '{"id":"n7","label":"Optimizer","row":6,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n8","label":"Code Generator","row":7,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n9","label":"Machine Code","row":8,"col":0,"shape":"ellipse","color":"orange","role":"outcome"}'
    '],'
    '"edges":[{"from":"n1","to":"n2","label":""},{"from":"n2","to":"n3","label":""},'
    '{"from":"n3","to":"n4","label":""},{"from":"n4","to":"n5","label":""},'
    '{"from":"n5","to":"n6","label":""},{"from":"n6","to":"n7","label":""},'
    '{"from":"n7","to":"n8","label":""},{"from":"n8","to":"n9","label":""}]},'
    '"offer_visual":false}\n'
)

ALL_FORMAT_EXAMPLES = (
    BST_EXAMPLE + "\n" + HASH_TABLE_EXAMPLE + "\n" + ASTAR_DIJKSTRA_EXAMPLE + "\n"
    + CPU_SCHEDULING_EXAMPLE + "\n" + TCP_FLOWCHART_EXAMPLE + "\n" + COMPILER_PIPELINE_EXAMPLE
)
