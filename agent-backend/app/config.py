"""Configuration for qPTM Agent Backend.

Loads settings from environment variables / .env file.

Local datasets under data/ are organized by PTM research aspect
(see data/README.md), not by database name.
"""

from pydantic_settings import BaseSettings
from pathlib import Path


_BACKEND_ROOT = Path(__file__).parent.parent
_DATA_ROOT = _BACKEND_ROOT / "data"
_RUNTIME_ROOT = _BACKEND_ROOT / "runtime"
_REPO_ROOT = _BACKEND_ROOT.parent


class Settings(BaseSettings):
    # LLM API (OpenCode Go / Zen — OpenAI-compatible; env names kept for compatibility)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://opencode.ai/zen/go/v1"
    deepseek_zen_base_url: str = "https://opencode.ai/zen/v1"
    deepseek_model: str = "deepseek-flash"
    # Comma-separated bare model ids tried after DEEPSEEK_MODEL on failure
    deepseek_fallback_models: str = "deepseek-v4-flash,glm-5.2,deepseek-v4-pro"

    # qPTM REST API (PHP backend — deployed at /api/ on the qPTM web server)
    qptm_api_base_url: str = "https://qptm3.omicsbio.info/api"

    # External database APIs
    uniprot_api_base_url: str = "https://rest.uniprot.org"
    iptmnet_api_base_url: str = "https://research.bioinformatics.udel.edu/iptmnet/api"
    activedriver_api_base_url: str = "https://activedriverdb.org"
    string_api_base_url: str = "https://cn.string-db.org/api"
    biogrid_api_base_url: str = "https://webservice.thebiogrid.org"
    biogrid_access_key: str = ""
    intact_api_base_url: str = (
        "https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search"
    )
    reactome_api_base_url: str = "https://reactome.org/ContentService"
    kegg_api_base_url: str = "https://rest.kegg.jp"
    interpro_api_base_url: str = "https://www.ebi.ac.uk/interpro/api"
    pubtator_api_base_url: str = "https://www.ncbi.nlm.nih.gov/research/pubtator3-api"
    pathbank_data_dir: str = str(_DATA_ROOT / "pathways" / "PathBank")
    subcell_data_dir: str = str(_DATA_ROOT / "localization" / "SubCELL")
    # eKPI Quantitative matrices (per-site *.csv.gz; large — not copied into data/)
    ekpi_data_dir: str = "/var/www/html/ekpi"
    ekpi_final_result_dir: str = "/var/www/html/ekpi/final_result"

    # Local data root (aspect-classified PTM datasets)
    data_root: str = str(_DATA_ROOT)

    # Aspect → source directories (relative defaults under data/)
    # Stage 1 — WHO (writers / erasers)
    enzymes_data_dir: str = str(_DATA_ROOT / "enzymes")
    # Stage 3 WHERE + Stage 4 WHY (split by functional aspect)
    psp_data_dir: str = str(_DATA_ROOT / "regulation" / "PhosphoSitePlus")
    psp_enzymes_data_dir: str = str(_DATA_ROOT / "enzymes" / "PhosphoSitePlus")
    psp_disease_data_dir: str = str(_DATA_ROOT / "disease" / "PhosphositePlus")
    funcscore_data_dir: str = str(_DATA_ROOT / "regulation" / "Funcscore")
    ptmint_data_dir: str = str(_DATA_ROOT / "interactions" / "PTMint")
    ptmcode_data_dir: str = str(_DATA_ROOT / "interactions" / "PTMcode2")
    stability_data_dir: str = str(_DATA_ROOT / "stability" / "curated")
    ptmphase_data_dir: str = str(_DATA_ROOT / "phase_separation" / "ptmphase")
    dscope_data_dir: str = str(_DATA_ROOT / "phase_separation" / "dscope")
    dbptm_data_dir: str = str(_DATA_ROOT / "disease" / "dbptm")
    activedriver_data_dir: str = str(_DATA_ROOT / "disease" / "ActiveDriverDB")
    ptmd_data_dir: str = str(_DATA_ROOT / "disease" / "PTMD")
    cancerproteome_data_dir: str = str(_DATA_ROOT / "disease" / "CancerProteome")
    pmads_data_dir: str = str(_DATA_ROOT / "drug" / "PMADS")
    drugbank_data_dir: str = str(_DATA_ROOT / "drug" / "DrugBank")
    decryptm_data_dir: str = str(_DATA_ROOT / "drug" / "decryptM")
    proteomicsdb_api_base_url: str = "https://www.proteomicsdb.org"
    localization_data_dir: str = str(_DATA_ROOT / "localization")
    compartments_data_dir: str = str(_DATA_ROOT / "localization" / "COMPARTMENTS")
    inuloc_data_dir: str = str(_DATA_ROOT / "localization" / "iNuLoC")

    # Runtime state for the chat backend (not scientific data)
    conversations_data_dir: str = str(_RUNTIME_ROOT / "conversations")

    # Collection Agent (literature-mining pipeline — Node subprocess)
    collection_agent_dir: str = str(_REPO_ROOT / "collection-agent")
    # Job workspaces belong with collection-agent (CLI cwd), not agent-backend/data.
    collection_jobs_dir: str = str(
        _REPO_ROOT / "collection-agent" / "runtime" / "collection" / "jobs"
    )
    collection_node_bin: str = "/opt/node22/bin/node"
    collection_max_upload_bytes: int = 50 * 1024 * 1024
    # Hard *idle* deadline (seconds): kill only when the child emits no stdout
    # for this long. Large Stage5 parses send heartbeats so wall-clock can exceed
    # this value safely; a truly hung process is still reaped.
    collection_stage_timeout_seconds: int = 1800
    # pi-ai id, e.g. opencode-go/deepseek-v4-flash — separate from DEEPSEEK_MODEL (chat)
    collection_model: str = ""
    # Comma-separated pi-ai provider/model ids tried after COLLECTION_MODEL
    collection_fallback_models: str = (
        "opencode-go/deepseek-v4-flash,"
        "opencode-go/glm-5.2,"
        "opencode-go/deepseek-v4-pro"
    )
    unpaywall_email: str = ""
    ncbi_api_key: str = ""
    ncbi_email: str = ""
    qptm3_get_url_dir: str = str(_REPO_ROOT / "collection-agent" / "scripts")

    # Server
    host: str = "0.0.0.0"
    port: int = 8100

    # CORS
    cors_origins: str = "http://localhost,http://qptm3.omicsbio.info,https://qptm3.omicsbio.info"

    # HTTP client defaults
    http_timeout_seconds: int = 60
    # LLM stream/response read idle timeout (seconds). Prevents forever "Generating answer..."
    llm_read_timeout_seconds: int = 120

    # Literature enrichment (used by app.agent.literature for tool evidence)
    literature_enrichment_enabled: bool = True
    literature_abstract_limit: int = 5
    literature_auto_fetch_api_pmids: bool = True
    literature_max_abstract_chars: int = 2000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
