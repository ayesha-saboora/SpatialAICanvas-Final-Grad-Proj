"""
Build the labeled prompt dataset for the Prompt Intent Classifier.

This is a fine-grained pedagogical taxonomy (48 intent classes) covering math,
physics, programming, ML, engineering, research, study support and verification,
plus three app-specific visual intents that drive StudyCanvas diagram generation:
  GRAPH_FUNCTION, DRAW_FLOWCHART, DRAW_LABELED_DIAGRAM

Hand-written SEED prompts (from the project owner) are always included; the rest
are generated programmatically from per-class templates x topic banks. Same
topics deliberately appear across classes so the model learns from the request
*phrasing*, not the topic word.

Output: datasets/intent/intent_prompts.csv  (columns: text,label)
"""

from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "datasets" / "intent"
OUT_CSV = OUT_DIR / "intent_prompts.csv"

PER_CLASS_CAP = 36

# ---------------------------------------------------------------------------
# Shared topic banks
# ---------------------------------------------------------------------------
MATH_EXPR = ["x^2 - 9", "x^2 sin(x)", "3x^2 + 2x - 5", "sin^2(x)", "1/(x^2 + 1)",
             "x^3 - 3x", "e^x cos(x)", "(x^2 - 4)/(x - 2)", "2x^2 - 8", "cos(x)/x"]
MATH_FUNC = ["x^2 sin(x)", "ln(x)", "e^x", "tan(x)", "1/(1+x^2)", "x^3 - 3x",
             "sin(x)/x", "sqrt(x)", "x^2 e^-x", "arctan(x)", "y = x^2", "y = -x^2 + 4"]
MATH_CONCEPT = ["eigenvalues", "the product rule", "the chain rule", "limits",
                "Taylor series", "vector spaces", "determinants",
                "the central limit theorem", "complex numbers", "matrix rank"]
MATH_THEOREM = ["the Pythagorean theorem", "that sqrt(2) is irrational", "the binomial theorem",
                "Bayes theorem", "the fundamental theorem of calculus",
                "that there are infinitely many primes", "the mean value theorem"]
PHYS_CONCEPT = ["entropy", "quantum tunneling", "special relativity",
                "the uncertainty principle", "angular momentum",
                "electromagnetic induction", "wave-particle duality", "the photoelectric effect"]
PHYS_NUM = ["the velocity after 5 seconds under gravity", "the electric field at point P",
            "the kinetic energy of a 2 kg ball at 3 m/s", "the current through a 10 ohm resistor",
            "the period of a 1 m pendulum", "the force on a 5 kg mass accelerating at 2 m/s^2",
            "the final temperature of the mixture", "the momentum of the system"]
PHYS_EQUATION = ["the kinematic equations", "Schrodinger's equation", "Maxwell's equations",
                 "the lens equation", "the wave equation", "the ideal gas law", "the Lorentz force law"]
CODE_SNIPPET = ["this Python recursion code", "this BFS implementation", "this sorting function",
                "my linked list code", "this dynamic programming solution", "this merge sort",
                "my binary search function", "this graph traversal"]
CS_CONCEPT = ["dynamic programming", "asymptotic notation", "attention mechanisms", "SLAM",
              "blockchain consensus", "compiler parsing", "ambiguity in context-free grammars",
              "post-quantum cryptography", "garbage collection", "virtual memory"]
ENG_SYSTEM = ["a traffic light controller", "a waste-sorting robot", "a distributed system",
              "a home automation system", "an elevator control system", "a temperature regulation system"]
ENG_CIRCUIT = ["this RC circuit", "this op-amp circuit", "this RLC network",
               "this voltage divider", "this transistor amplifier"]
ENG_SIGNAL = ["the transfer function", "the frequency response", "the impulse response",
              "the Fourier transform of this signal", "the Bode plot"]
ML_CONCEPT = ["gradient descent", "precision and recall", "regularization",
              "the bias-variance tradeoff", "backpropagation", "cross-validation", "dropout"]
ML_RESULTS = ["these confusion matrix results", "these p-values", "this ROC curve",
              "these accuracy metrics", "this regression output", "these clustering results"]
ML_COMPARE = ["Random Forest and XGBoost", "CNNs and Transformers", "SGD and Adam",
              "L1 and L2 regularization", "bagging and boosting"]
DATA_TASKS = ["this dataset", "this sales data", "these survey results", "this time series",
              "this experiment's data"]
PAPER = ["this research paper", "this thesis chapter", "this conference paper",
         "this journal article", "this preprint"]
STUDY_TOPIC = ["compiler design", "MPI", "OpenCL", "CUDA", "operating systems",
               "cryptography", "computer networks", "database systems", "machine learning",
               "digital logic", "data structures", "algorithm analysis"]
PROCESS = ["binary search", "glycolysis", "the TCP handshake", "DNA replication", "gradient descent",
           "the compilation pipeline", "a login system", "bubble sort", "the water cycle",
           "photosynthesis", "the cardiac cycle", "Dijkstra's algorithm",
           "BST insertion order", "hash table collision resolution", "A* pathfinding",
           "CPU scheduling FCFS SJF Round Robin", "TCP connection lifecycle",
           "compiler pipeline stages", "open addressing vs chaining"]
ANATOMY = ["the human heart", "a neuron", "a plant cell", "the nephron", "a mitochondrion",
           "the human eye", "a BJT transistor", "the benzene ring", "a four-stroke engine",
           "the respiratory system"]

GENERIC_CONCEPT = MATH_CONCEPT + PHYS_CONCEPT + CS_CONCEPT + ML_CONCEPT

# ---------------------------------------------------------------------------
# Per-class (templates, topics)
# ---------------------------------------------------------------------------
CLASSES: dict[str, tuple[list[str], list[str]]] = {
    # ---- App visual intents ----
    "DRAW_FLOWCHART": (
        ["draw a flowchart of {x}", "make a flowchart for {x}",
         "show the steps of {x} as a flowchart", "flowchart the process of {x}",
         "visualize the steps of {x} on my canvas", "diagram the workflow of {x}"],
        PROCESS),
    "DRAW_LABELED_DIAGRAM": (
        ["draw a labeled diagram of {x}", "show the parts of {x}",
         "label the structure of {x}", "draw and label {x}", "illustrate {x} with labels",
         "sketch {x} and label its parts"],
        ANATOMY),
    "GRAPH_FUNCTION": (
        ["graph {x}", "plot {x}", "draw the graph of {x}", "sketch {x}",
         "plot the function {x}", "graph the curve {x}", "show {x} on a coordinate plane"],
        MATH_FUNC),
    "VISUALIZATION_IMPROVEMENT": (
        ["improve this graph", "review this graph", "critique this graph",
         "make this graph better", "fix this graph", "improve the {x} of this graph",
         "review this graph for {x}", "is this graph correct", "whats wrong with this graph",
         "improve this plot", "review this chart", "improve this visualization",
         "redraw this graph more clearly", "make this graph easier to read",
         "fix the {x} on this graph", "improve this figure for learning",
         "review my graph and suggest improvements", "this graph is hard to read, improve it"],
        ["scaling", "readability", "labeling", "axes", "colors", "title", "y-range",
         "important points", "clarity"]),
    # ---- Understanding ----
    "EXPLAIN_CONCEPT": (
        ["explain {x}", "what is {x}", "how does {x} work", "tell me about {x}",
         "what are the key ideas of {x}", "give an overview of {x}"],
        GENERIC_CONCEPT),
    "EXPLAIN_INTUITIVELY": (
        ["explain {x} intuitively", "give me the intuition behind {x}",
         "what's the intuitive idea behind {x}", "help me build intuition for {x}",
         "visualize {x} intuitively"],
        GENERIC_CONCEPT),
    "ELI5_EXPLANATION": (
        ["explain {x} like I'm five", "explain {x} like I'm a beginner", "ELI5 {x}",
         "explain {x} in the simplest terms", "explain {x} as if I knew nothing about it"],
        GENERIC_CONCEPT),
    "REAL_WORLD_APPLICATION": (
        ["how is {x} used in real life", "what are real-world applications of {x}",
         "where is {x} used in practice", "give practical applications of {x}",
         "how is {x} used in real life applications"],
        GENERIC_CONCEPT),
    "ANALOGY_GENERATION": (
        ["give me an analogy for {x}", "explain {x} using an analogy",
         "what's a good metaphor for {x}", "find an analogy to help me understand {x}"],
        GENERIC_CONCEPT),
    # ---- Mathematics ----
    "SOLVE_STEP_BY_STEP": (
        ["solve {x} step by step", "work through {x} step by step",
         "show me how to solve {x} with all steps", "solve {x} and explain each step",
         "find the derivative of {x} and explain every step"],
        MATH_EXPR),
    "DERIVE_FORMULA": (
        ["derive the {x}", "show the derivation of the {x}", "where does the {x} come from",
         "derive the formula for the {x}"],
        ["quadratic formula", "area of a circle", "volume of a sphere", "distance formula",
         "sum of an arithmetic series", "compound interest formula", "Euler's formula"]),
    "PROVE_THEOREM": (
        ["prove {x}", "give a proof of {x}", "prove that {x}", "show a proof for {x}"],
        MATH_THEOREM),
    "SIMPLIFY_EXPRESSION": (
        ["simplify {x}", "reduce {x} to simplest form", "simplify the expression {x}"],
        MATH_EXPR + ["(2x + 4)/2", "(x^2 - 1)/(x - 1)", "3x + 2x - x", "sin^2(x) + cos^2(x)"]),
    "FACTOR_EXPRESSION": (
        ["factor {x}", "factorize {x}", "factor the expression {x}", "find the factors of {x}"],
        ["x^2 - 9", "x^2 - 5x + 6", "2x^2 + 7x + 3", "x^3 - 8", "x^2 - 4", "6x^2 - x - 2"]),
    "INTEGRATE_FUNCTION": (
        ["integrate {x}", "find the integral of {x}", "compute the integral of {x}",
         "what is the antiderivative of {x}"],
        ["sin^2(x)", "x e^x", "1/(x^2+1)", "ln(x)", "x^2 cos(x)", "sec^2(x)", "e^x sin(x)"]),
    "DIFFERENTIATE_FUNCTION": (
        ["differentiate {x}", "find the derivative of {x}", "compute d/dx of {x}",
         "what is the derivative of {x}"],
        MATH_FUNC),
    "CHECK_MATH_SOLUTION": (
        ["I got {x}, check if my answer is correct", "is my answer {x} correct",
         "check my solution: {x}", "verify my answer {x}", "I solved it and got {x}, is that right"],
        ["x = 4", "x = -2", "12", "3/5", "x = 0 and x = 3", "y = 7"]),
    "FIND_ERROR": (
        ["find the mistake in my {x}", "show where my {x} went wrong",
         "what's wrong with my {x}", "find the error in my {x}", "spot the flaw in my {x}"],
        ["integration", "derivation", "force calculation", "algebra", "limit computation",
         "matrix multiplication", "proof attempt"]),
    # ---- Physics ----
    "SOLVE_NUMERICAL": (
        ["calculate {x}", "find {x}", "compute {x}", "determine {x}", "what is {x}"],
        PHYS_NUM),
    "EXPLAIN_PHYSICAL_MEANING": (
        ["what does {x} actually mean", "explain the physical meaning of {x}",
         "what is the physical interpretation of {x}", "what does {x} represent physically"],
        ["entropy", "the wavefunction", "the curl of a field", "the divergence",
         "imaginary time", "the Poynting vector", "the Hamiltonian", "negative temperature"]),
    "UNIT_ANALYSIS": (
        ["check the units of {x}", "do a dimensional analysis of {x}",
         "verify the units in {x}", "are the units consistent in {x}",
         "check dimensional consistency of {x}"],
        ["this formula", "F = ma", "the energy equation", "this expression",
         "the drag equation", "v = u + at"]),
    "DERIVE_EQUATION": (
        ["derive {x}", "show the derivation of {x}", "derive the equation for {x}"],
        PHYS_EQUATION),
    # ---- Programming ----
    "DEBUG_CODE": (
        ["debug {x}", "fix the bug in {x}", "find the bug in {x}", "why does {x} crash",
         "find the bug causing segmentation faults in {x}"],
        CODE_SNIPPET),
    "EXPLAIN_CODE": (
        ["explain {x}", "what does {x} do", "walk me through {x}", "explain how {x} works"],
        CODE_SNIPPET),
    "OPTIMIZE_CODE": (
        ["optimize {x}", "can {x} be optimized", "make {x} faster",
         "improve the performance of {x}", "optimize this SQL query for {x}"],
        CODE_SNIPPET),
    "FIND_COMPLEXITY": (
        ["what's the time complexity of {x}", "find the complexity of {x}",
         "what is the Big-O of {x}", "analyze the time complexity of {x}",
         "what is the space complexity of {x}"],
        CODE_SNIPPET + ["this algorithm", "merge sort", "this nested loop"]),
    "GENERATE_CODE": (
        ["write {x}", "generate {x}", "write code for {x}", "implement {x}", "give me code for {x}"],
        ["Dijkstra's algorithm in Java", "a logistic regression in Python",
         "Arduino code to blink an LED", "ROS code for robot navigation",
         "a binary search in C++", "a REST API in Flask", "quicksort in Python"]),
    "COMPLETE_CODE": (
        ["complete the missing function in {x}", "finish this {x}",
         "fill in the rest of {x}", "complete the implementation of {x}"],
        CODE_SNIPPET + ["this class", "this loop"]),
    # ---- Engineering ----
    "CIRCUIT_ANALYSIS": (
        ["analyze {x}", "find the voltage across {x}", "solve {x}",
         "find the current in {x}", "compute the equivalent resistance of {x}"],
        ENG_CIRCUIT),
    "SIGNAL_ANALYSIS": (
        ["find {x}", "compute {x}", "analyze {x}", "determine {x}"],
        ENG_SIGNAL),
    "SYSTEM_DESIGN": (
        ["design {x}", "how would you design {x}", "design a system for {x}", "architect {x}"],
        ENG_SYSTEM),
    "ALGORITHM_DESIGN": (
        ["design an algorithm for {x}", "come up with an algorithm to {x}",
         "devise an algorithm for {x}", "design an efficient approach for {x}"],
        ["route planning", "scheduling tasks", "matching students to projects",
         "detecting cycles in a graph", "load balancing", "finding the shortest path"]),
    # ---- Study support ----
    "SUMMARIZE_NOTES": (
        ["summarize {x}", "make a revision sheet for {x}", "give me a summary of {x}",
         "condense {x} into key points", "summarize my notes on {x}"],
        STUDY_TOPIC + ["this research paper", "this thesis chapter", "this lecture", "chapter 5"]),
    "CREATE_FLASHCARDS": (
        ["create flashcards for {x}", "make flashcards on {x}",
         "generate flashcards for {x}", "turn {x} into flashcards"],
        STUDY_TOPIC),
    "CREATE_QUIZ": (
        ["create a quiz on {x}", "generate viva questions for {x}",
         "test my understanding of {x}", "make quiz questions for {x}",
         "generate {x} interview questions"],
        STUDY_TOPIC),
    "GENERATE_PRACTICE_PROBLEMS": (
        ["give me practice problems for {x}", "generate practice questions on {x}",
         "generate exam-level challenges for {x}", "make practice problems about {x}",
         "generate harder versions of these {x} problems"],
        STUDY_TOPIC),
    "EXAM_PREPARATION": (
        ["prepare me for my {x} exam", "help me prepare for tomorrow's {x} exam",
         "create memory tricks for {x}", "how should I revise {x} for the exam",
         "give me exam tips for {x}"],
        STUDY_TOPIC),
    # ---- Research ----
    "LITERATURE_REVIEW": (
        ["generate related work for {x}", "write a literature review on {x}",
         "summarize the literature on {x}", "what's the prior work on {x}"],
        ["my thesis topic", "graph neural networks", "post-quantum cryptography",
         "federated learning", "image segmentation", "reinforcement learning"]),
    "COMPARE_PAPERS": (
        ["compare these two papers", "compare this paper with prior work",
         "how do these papers differ", "compare the results with prior work",
         "contrast {x} with the related paper"],
        PAPER),
    "RESEARCH_IDEA": (
        ["suggest a novel research direction in {x}", "identify research gaps in {x}",
         "propose a research idea for {x}", "generate quantum-resistant alternatives for {x}",
         "what's an open problem in {x}"],
        ["machine learning", "cryptography", "robotics", "computer vision", "NLP",
         "distributed systems"]),
    "CRITIQUE_METHOD": (
        ["critique the methodology of {x}", "review the methodology section of {x}",
         "evaluate the experimental design of {x}", "explain the limitations of {x}",
         "what are the weaknesses of {x}"],
        PAPER + ["this study", "my experiment"]),
    # ---- Data science ----
    "DATA_ANALYSIS": (
        ["analyze {x}", "explore {x}", "what trends are in {x}",
         "analyze the statistical significance in {x}", "do an exploratory analysis of {x}"],
        DATA_TASKS),
    "MODEL_EXPLANATION": (
        ["why is my model {x}", "explain why my model {x}", "why did my model {x}",
         "suggest improvements because my model {x}"],
        ["overfitting", "underfitting", "not converging", "predicting only one class",
         "performing poorly on test data"]),
    "FEATURE_SELECTION": (
        ["which features should I remove from {x}", "what features matter most in {x}",
         "help me select features for {x}", "which variables should I drop in {x}"],
        DATA_TASKS + ["my model", "this regression"]),
    "RESULT_INTERPRETATION": (
        ["interpret {x}", "what do {x} tell me", "help me interpret {x}",
         "interpret the results of {x}"],
        ML_RESULTS + ["these YOLO detection results", "this p-value", "these confidence intervals"]),
    # ---- Verification ----
    "CHECK_ANSWER": (
        ["check my answer for {x}", "is my {x} answer correct", "check my {x} calculations",
         "verify my answer for {x}", "did I get the {x} right"],
        ["circuit", "physics", "chemistry", "this problem", "the homework"]),
    "VERIFY_REASONING": (
        ["verify my reasoning about {x}", "check my proof of {x}",
         "is my reasoning correct for {x}", "verify the correctness of {x}",
         "analyze whether {x} is correct"],
        ["this algorithm", "this induction proof", "my argument", "this theorem proof", "the parser"]),
    "FACT_CHECK": (
        ["is it true that {x}", "fact-check this: {x}", "verify whether {x}", "is {x} accurate"],
        ["water boils at 90C at sea level", "the Great Wall is visible from space",
         "humans use only 10% of their brain", "light travels faster than sound",
         "the speed of light is constant"]),
    # ---- Comparison ----
    "COMPARE_METHODS": (
        ["compare {x}", "what's the difference between {x}", "contrast {x}", "{x}: which is better"],
        ML_COMPARE + ["BFS and DFS", "Newtonian mechanics and relativity",
                      "analog and digital signals", "RSA and Kyber", "AES and ChaCha20",
                      "SN1 and SN2 reactions", "TCP and UDP", "supervised and unsupervised learning"]),
}

# Hand-written seed prompts (always included).
SEED: list[tuple[str, str]] = [
    ("Find the derivative of x^2 sin(x) and explain every step.", "SOLVE_STEP_BY_STEP"),
    ("Why does the product rule work?", "EXPLAIN_CONCEPT"),
    ("Prove that sqrt(2) is irrational.", "PROVE_THEOREM"),
    ("Graph y=x^3-3x.", "GRAPH_FUNCTION"),
    ("Improve this graph.", "VISUALIZATION_IMPROVEMENT"),
    ("Review this graph and suggest improvements.", "VISUALIZATION_IMPROVEMENT"),
    ("This graph is hard to read on a small screen, fix it.", "VISUALIZATION_IMPROVEMENT"),
    ("The cubic should be y=x^3, not y=x^3-3x. Fix this graph.", "VISUALIZATION_IMPROVEMENT"),
    ("Make this plot clearer for students.", "VISUALIZATION_IMPROVEMENT"),
    ("Improve the scaling so the sine curve is visible.", "VISUALIZATION_IMPROVEMENT"),
    ("Critique this visualization and redraw it.", "VISUALIZATION_IMPROVEMENT"),
    ("Add important points and labels to this graph.", "VISUALIZATION_IMPROVEMENT"),
    ("I got x=4 for this equation. Check if my answer is correct.", "CHECK_MATH_SOLUTION"),
    ("Derive the quadratic formula.", "DERIVE_FORMULA"),
    ("Explain eigenvalues intuitively.", "EXPLAIN_INTUITIVELY"),
    ("Factor x^2-9.", "FACTOR_EXPRESSION"),
    ("Integrate sin^2(x).", "INTEGRATE_FUNCTION"),
    ("Find the mistake in my integration.", "FIND_ERROR"),
    ("Calculate the velocity after 5 seconds under gravity.", "SOLVE_NUMERICAL"),
    ("What does entropy actually mean?", "EXPLAIN_PHYSICAL_MEANING"),
    ("Derive the kinematic equations.", "DERIVE_EQUATION"),
    ("Check the units of this formula.", "UNIT_ANALYSIS"),
    ("Why can't anything travel faster than light?", "EXPLAIN_CONCEPT"),
    ("Explain Maxwell's equations like I'm a beginner.", "ELI5_EXPLANATION"),
    ("Compare Newtonian mechanics and relativity.", "COMPARE_METHODS"),
    ("How is quantum tunneling used in real life?", "REAL_WORLD_APPLICATION"),
    ("Find the electric field at point P.", "SOLVE_NUMERICAL"),
    ("Show where my force calculation went wrong.", "FIND_ERROR"),
    ("Debug this Python recursion code.", "DEBUG_CODE"),
    ("Explain this BFS implementation.", "EXPLAIN_CODE"),
    ("Can this algorithm be optimized?", "OPTIMIZE_CODE"),
    ("What's the time complexity?", "FIND_COMPLEXITY"),
    ("Write Dijkstra's algorithm in Java.", "GENERATE_CODE"),
    ("Complete the missing function.", "COMPLETE_CODE"),
    ("Design an algorithm for route planning.", "ALGORITHM_DESIGN"),
    ("Compare BFS and DFS.", "COMPARE_METHODS"),
    ("Why does dynamic programming work?", "EXPLAIN_CONCEPT"),
    ("Find the bug causing segmentation faults.", "DEBUG_CODE"),
    ("Explain gradient descent intuitively.", "EXPLAIN_INTUITIVELY"),
    ("Why is my model overfitting?", "MODEL_EXPLANATION"),
    ("Interpret these confusion matrix results.", "RESULT_INTERPRETATION"),
    ("Which features should I remove?", "FEATURE_SELECTION"),
    ("Compare Random Forest and XGBoost.", "COMPARE_METHODS"),
    ("Generate Python code for logistic regression.", "GENERATE_CODE"),
    ("Explain precision and recall.", "EXPLAIN_CONCEPT"),
    ("Analyze this dataset.", "DATA_ANALYSIS"),
    ("Suggest improvements to model performance.", "MODEL_EXPLANATION"),
    ("Why did accuracy drop after normalization?", "VERIFY_REASONING"),
    ("Analyze this RC circuit.", "CIRCUIT_ANALYSIS"),
    ("Design a traffic light controller.", "SYSTEM_DESIGN"),
    ("Explain PID control.", "EXPLAIN_CONCEPT"),
    ("Compare analog and digital signals.", "COMPARE_METHODS"),
    ("Find the transfer function.", "SIGNAL_ANALYSIS"),
    ("Design a waste-sorting robot.", "SYSTEM_DESIGN"),
    ("Why is my sensor noisy?", "VERIFY_REASONING"),
    ("Explain Kalman filters.", "EXPLAIN_CONCEPT"),
    ("Generate Arduino code.", "GENERATE_CODE"),
    ("Check my circuit calculations.", "CHECK_ANSWER"),
    ("Summarize this research paper.", "SUMMARIZE_NOTES"),
    ("Compare these two papers.", "COMPARE_PAPERS"),
    ("Suggest a novel research direction.", "RESEARCH_IDEA"),
    ("Critique the methodology.", "CRITIQUE_METHOD"),
    ("Explain the limitations.", "CRITIQUE_METHOD"),
    ("Generate related work.", "LITERATURE_REVIEW"),
    ("Identify research gaps.", "RESEARCH_IDEA"),
    ("Evaluate experimental design.", "CRITIQUE_METHOD"),
    ("Compare results with prior work.", "COMPARE_PAPERS"),
    ("Summarize this thesis chapter.", "SUMMARIZE_NOTES"),
    ("Create flashcards for compiler design.", "CREATE_FLASHCARDS"),
    ("Generate viva questions.", "CREATE_QUIZ"),
    ("Make a revision sheet.", "SUMMARIZE_NOTES"),
    ("Give me practice questions.", "GENERATE_PRACTICE_PROBLEMS"),
    ("Prepare me for tomorrow's exam.", "EXAM_PREPARATION"),
    ("Test my understanding of MPI.", "CREATE_QUIZ"),
    ("Generate CUDA interview questions.", "CREATE_QUIZ"),
    ("Summarize OpenCL.", "SUMMARIZE_NOTES"),
    ("Create memory tricks.", "EXAM_PREPARATION"),
    ("Generate harder versions of these problems.", "GENERATE_PRACTICE_PROBLEMS"),
    ("Derive Schrodinger's equation.", "DERIVE_EQUATION"),
    ("Prove Bayes theorem.", "PROVE_THEOREM"),
    ("Visualize gradient descent.", "EXPLAIN_INTUITIVELY"),
    ("Compare RSA and Kyber.", "COMPARE_METHODS"),
    ("Explain post-quantum cryptography.", "EXPLAIN_CONCEPT"),
    ("Check my proof.", "VERIFY_REASONING"),
    ("Find the flaw in this theorem proof.", "FIND_ERROR"),
    ("Analyze algorithm correctness.", "VERIFY_REASONING"),
    ("Explain asymptotic notation.", "EXPLAIN_CONCEPT"),
    ("Design a distributed system.", "SYSTEM_DESIGN"),
    ("Generate ROS code for robot navigation.", "GENERATE_CODE"),
    ("Explain SLAM.", "EXPLAIN_CONCEPT"),
    ("Analyze YOLO detection results.", "RESULT_INTERPRETATION"),
    ("Compare CNNs and Transformers.", "COMPARE_METHODS"),
    ("Explain attention mechanisms.", "EXPLAIN_CONCEPT"),
    ("Optimize this SQL query.", "OPTIMIZE_CODE"),
    ("Explain compiler parsing.", "EXPLAIN_CONCEPT"),
    ("Generate LALR parsing questions.", "CREATE_QUIZ"),
    ("Check parser correctness.", "VERIFY_REASONING"),
    ("Explain ambiguity in CFGs.", "EXPLAIN_CONCEPT"),
    ("Interpret p-values.", "RESULT_INTERPRETATION"),
    ("Analyze statistical significance.", "DATA_ANALYSIS"),
    ("Explain confidence intervals.", "EXPLAIN_CONCEPT"),
    ("Create a cryptography viva.", "CREATE_QUIZ"),
    ("Compare AES and ChaCha20.", "COMPARE_METHODS"),
    ("Generate quantum-resistant alternatives.", "RESEARCH_IDEA"),
    ("Review my methodology section.", "CRITIQUE_METHOD"),
    ("Explain blockchain consensus.", "EXPLAIN_CONCEPT"),
    ("Verify mathematical induction proof.", "VERIFY_REASONING"),
    ("Generate exam-level challenges.", "GENERATE_PRACTICE_PROBLEMS"),
    # ---- STEM canvas format training (BST, hash, A*, scheduling, TCP, compiler) ----
    ("Show BST formed by inserting 1,2,3,4,5,6,7 and 4,2,6,1,3,5,7", "DRAW_LABELED_DIAGRAM"),
    ("Draw degenerated vs balanced BST for insertion orders", "DRAW_LABELED_DIAGRAM"),
    ("Plot lookup cost vs load factor for hash tables", "GRAPH_FUNCTION"),
    ("Graph open addressing vs chaining as load factor increases", "GRAPH_FUNCTION"),
    ("Compare A* and Dijkstra search expansion on the same grid", "DRAW_FLOWCHART"),
    ("Draw a flowchart comparing A* vs Dijkstra pathfinding", "DRAW_FLOWCHART"),
    ("Compare FCFS SJF and Round Robin for P1=10ms P2=4ms P3=2ms", "DRAW_FLOWCHART"),
    ("Draw Gantt chart for CPU scheduling FCFS SJF Round Robin", "DRAW_FLOWCHART"),
    ("Draw the TCP three-way handshake flowchart with retransmission", "DRAW_FLOWCHART"),
    ("Flowchart the TCP connection lifecycle from SYN to FIN", "DRAW_FLOWCHART"),
    ("Draw the compiler pipeline from source code to machine code", "DRAW_FLOWCHART"),
    ("Show compiler stages: lexical parser semantic optimizer codegen", "DRAW_FLOWCHART"),
    ("Explain BST degeneration when inserting sorted keys", "EXPLAIN_CONCEPT"),
    ("When load factor approaches 1 compare open addressing and chaining", "COMPARE_METHODS"),
    ("Compare Dijkstra and A* on the same grid", "COMPARE_METHODS"),
    ("Explain TCP handshake and packet retransmission", "EXPLAIN_CONCEPT"),
    ("Explain the compiler pipeline stages", "EXPLAIN_CONCEPT"),
]


def build_rows() -> list[tuple[str, str]]:
    rng = random.Random(42)
    final: list[tuple[str, str]] = []

    for label, (templates, topics) in CLASSES.items():
        generated: list[tuple[str, str]] = []
        for t in templates:
            if "{x}" in t:
                for x in topics:
                    generated.append((t.format(x=x), label))
            else:
                generated.append((t, label))
        generated = list(dict.fromkeys(generated))
        rng.shuffle(generated)
        kept = generated[:PER_CLASS_CAP]

        # Always include seeds for this class.
        seeds = [(p, l) for p, l in SEED if l == label]
        for s in seeds:
            if s not in kept:
                kept.append(s)
        final.extend(kept)

    final = list(dict.fromkeys(final))
    rng.shuffle(final)
    return final


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = build_rows()

    counts: dict[str, int] = {}
    for _, label in rows:
        counts[label] = counts.get(label, 0) + 1

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["text", "label"])
        writer.writerows(rows)

    print(f"Wrote {len(rows)} labeled prompts across {len(counts)} classes -> {OUT_CSV}")
    for label, n in sorted(counts.items()):
        print(f"  {label:26s}: {n}")


if __name__ == "__main__":
    main()
