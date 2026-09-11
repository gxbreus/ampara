# Como contribuir

## Identidade do autor

Antes do primeiro commit, cada integrante deve conferir sua identidade:

```bash
git config user.name "Nome completo"
git config user.email "email-vinculado-ao-github@example.com"
```

## Fluxo de branches

Toda funcionalidade deve partir de `develop`:

```bash
git switch develop
git pull origin develop
git switch -c feature/nome-da-funcionalidade
```

Depois de concluir e validar a mudança:

```bash
git add caminho/dos/arquivos
git commit -m "feat: descreve a funcionalidade"
git push -u origin feature/nome-da-funcionalidade
```

Abra um pull request para `develop`. Outro integrante deve revisar e aprovar antes do merge.

## Trabalho em pares

Quando duas pessoas trabalharem no mesmo commit, registre a coautoria no final da mensagem:

```text
Co-authored-by: Nome do integrante <email-vinculado-ao-github@example.com>
```

## Revisão obrigatória

- o autor do pull request não pode aprovar a própria mudança;
- ao menos outro integrante deve aprovar o PR;
- o PR deve registrar o que mudou e como a alteração foi testada;
- correções apontadas nas apresentações devem entrar em novos commits.

