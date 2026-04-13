import type {
  AgentContextAssemblyService,
  DecisionSummaryService,
  ContextPacketService,
  RetrieveContextService
} from "@multi-agent-brain/application";
import type {
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  GetDecisionSummaryRequest,
  RetrieveContextRequest
} from "@multi-agent-brain/contracts";
export class BrainRetrievalController {
  constructor(
    private readonly retrieveContextService: RetrieveContextService,
    private readonly decisionSummaryService: DecisionSummaryService,
    private readonly contextPacketService: ContextPacketService,
    private readonly agentContextAssemblyService: AgentContextAssemblyService
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
