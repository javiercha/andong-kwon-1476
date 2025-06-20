# The Andong Kwŏn Genealogy of 1476

## Javier Cha (University of Hong Kong)

This repository contains the first public release of a critical digital edition of the *Andong Kwŏn Genealogy of 1476* (*Andong Kwŏn ssi Sŏnghwabo* 安東權氏成化譜), the oldest extant comprehensive genealogy in Korea. This source is particularly valuable for its inclusion of the Kwŏn clan's extended kin network, encompassing multiple generations of affinal descendants.

This release includes TSV-formatted node and edge tables, high-resolution facsimiles, and a suite of Jupyter notebooks for data preprocessing (e.g., Unicode normalization and LLM-assisted romanization of hanja names) and graph-based exploration (e.g., Neo4j import and inspection of the digitized content against the original).

This digital edition was created as a supplement to my monograph-in-progress, _Yangban as Graphs: Networks of Marriage and Patronage in Medieval Korea_. A machine-assisted rereading of the *Andong Kwŏn Genealogy of 1476* plays a central role in advancing my argument that structurally embedded in-group marriages helped stabilize membership in the medieval yangban aristocracy.

---

### Included in the 20 June 2025 Release

#### `Unicode Normalization.ipynb`
Applies NFKC normalization to ensure consistency across Unicode variants.

#### `McCune-Reischauer Romanization GPT-4o.ipynb`
Uses **OpenAI's GPT-4o** to automate the romanization of hanja names. Despite not being fine-tuned for the McCune–Reischauer system, the model performed well enough to significantly reduce manual workload.

#### `tsv/`
Includes the node (`andongkwon_1476_nodes.tsv`) and edge (`andongkwon_1476_edges.tsv`) tables for import into a Neo4j database.

#### `facsimile/`
High-resolution scanned images of the genealogy from the Academy of Korean Studies.

#### `inspection/`
**PNG** and **SVG** page renderings for side-by-side visual inspection and verification of the structured data against the original scans.

#### `Andong Kwon Genealogy Neo4j Import.ipynb`
Automates the import of TSV data into a Neo4j database, preparing it for network analysis and graph queries.

#### `Andong Kwon Genealogy Inspection.ipynb`
Verifies the fidelity of the digitized data against the original facsimile. Aims to ensure 100% faithful transcription and layout representation.

---

### Coming Soon

The next release will include a notebook that demonstrates how to translate historical research questions—specifically regarding structural endogamy and its role in the formation of the medieval yangban aristocracy—into graph queries using Neo4j. The notebook will feature data visualizations suitable for integration into academic monographs or journal articles.

Final verification is still underway. In the meantime, feedback and collaboration are warmly welcomed as this open dataset continues to be updated.
