"""Register all tools — shared by FastAPI main and MCP server."""

from __future__ import annotations

from app.tools.registry import registry
from app.tools.qptm_tools import register_qptm_tools
from app.tools.iptmnet_tools import register_iptmnet_tools
from app.tools.uniprot_tools import register_uniprot_tools
from app.tools.psp_tools import register_psp_tools
from app.tools.dbptm_tools import register_dbptm_tools
from app.tools.stability_tools import register_stability_tools
from app.tools.activedriver_tools import register_activedriver_tools
from app.tools.pmads_tools import register_pmads_tools
from app.tools.drugbank_tools import register_drugbank_tools
from app.tools.weram_tools import register_weram_tools
from app.tools.ubibrowser_tools import register_ubibrowser_tools
from app.tools.gpsuber_tools import register_gpsuber_tools
from app.tools.gps6_tools import register_gps6_tools
from app.tools.gpssumo2_tools import register_gpssumo2_tools
from app.tools.kaka_tools import register_kaka_tools
from app.tools.ekpi_tools import register_ekpi_tools
from app.tools.ptmphase_tools import register_ptmphase_tools
from app.tools.dscope_tools import register_dscope_tools
from app.tools.ptmd_tools import register_ptmd_tools
from app.tools.cancerproteome_tools import register_cancerproteome_tools
from app.tools.ptmint_tools import register_ptmint_tools
from app.tools.ppi_api_tools import register_ppi_api_tools
from app.tools.pathway_tools import register_pathway_tools
from app.tools.ptmcode_tools import register_ptmcode_tools
from app.tools.inuloc_tools import register_inuloc_tools
from app.tools.funcscore_tools import register_funcscore_tools
from app.tools.decryptm_tools import register_decryptm_tools
from app.tools.compartments_tools import register_compartments_tools
from app.tools.subcell_tools import register_subcell_tools
from app.tools.domain_tools import register_domain_tools
from app.tools.pubtator_tools import register_pubtator_tools
from app.tools.signalp_tools import register_signalp_tools

_registered = False


def register_all_tools() -> None:
    global _registered
    if _registered:
        return
    register_qptm_tools()
    register_iptmnet_tools()
    register_uniprot_tools()
    register_psp_tools()
    register_dbptm_tools()
    register_stability_tools()
    register_activedriver_tools()
    register_pmads_tools()
    register_drugbank_tools()
    register_weram_tools()
    register_ubibrowser_tools()
    register_gpsuber_tools()
    register_gps6_tools()
    register_gpssumo2_tools()
    register_kaka_tools()
    register_ekpi_tools()
    register_ptmphase_tools()
    register_dscope_tools()
    register_ptmd_tools()
    register_cancerproteome_tools()
    register_ptmint_tools()
    register_ppi_api_tools()
    register_pathway_tools()
    register_ptmcode_tools()
    register_inuloc_tools()
    register_funcscore_tools()
    register_decryptm_tools()
    register_compartments_tools()
    register_subcell_tools()
    register_domain_tools()
    register_pubtator_tools()
    register_signalp_tools()
    _registered = True
