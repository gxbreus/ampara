# Privacidade e limites do Assistente Ampara

Fonte: [Equipe Ampara; síntese dos requisitos de LLM e privacidade](https://github.com/gxbreus/ampara/blob/develop/docs/requisitos.md).
Seção de referência: LLM e requisitos não funcionais.
Consulta: 2026-11-17. Tipo: documentacao_ampara.
Natureza: síntese editorial da Ampara; não é reprodução integral da fonte.

## LLM e requisitos não funcionais

O Assistente trata de adoção responsável e cuidados com animais. Perguntas devem usar fontes da base, e recomendações consultam dados reais de animais disponíveis. A indisponibilidade do provedor deve produzir fallback explícito sem interromper busca e adoção. O projeto prevê não enviar dados pessoais ao provedor. Não inserir nome, documento, e-mail ou endereço na pergunta; localização precisa ser tratada separadamente pelo servidor.
