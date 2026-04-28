import type {
  AgentContextAssemblyService,
  ContextNamespaceService,
  DecisionSummaryService,
  ContextPacketService,
  RetrieveContextService
} from "@mimir/application";
import type {
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  GetDecisionSummaryRequest,
  ListContextTreeRequest,
  ReadContextNodeRequest,
  RetrieveContextRequest
} from "@mimir/contracts";
export class MimisbrunnrRetrievalController {
  constructor(
    private readonly retrieveContextService: RetrieveContextService,
    private readonly decisionSummaryService: DecisionSummaryService,
    private readonly contextPacketService: ContextPacketService,
    private readonly agentContextAssemblyService: AgentContextAssemblyService,
    private readonly contextNamespaceService: ContextNamespaceService
  ) {}

  async searchContext(
    request: RetrieveContextRequest
  ) {
    return this.retrieveContextService.retrieveContext(request);
  }

  async fetchDecisionSummary(
    request: GetDecisionSummaryRequest
  ) {
    return this.decisionSummaryService.getDecisionSummary(request);
  }

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ) {
    return this.agentContextAssemblyService.assembleAgentContext(request);
  }

  async listContextTree(
    request: ListContextTreeRequest
  ) {
    return this.contextNamespaceService.listTree(request);
  }

  async readContextNode(
    request: ReadContextNodeRequest
  ) {
    return this.contextNamespaceService.readNode(request);
  }

  async getContextPacket(
    request: AssembleContextPacketRequest
  ): Promise<AssembleContextPacketResponse> {
    const answerability =
      request.candidates.length === 0
        ? "needs_escalation"
        : (request.candidates[0]?.score ?? 0) >= 0.72
          ? "local_answer"
          : "partial";

    return this.contextPacketService.assemblePacket(request, answerability);
  }
}
