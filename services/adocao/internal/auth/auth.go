// Package auth verifica o JWT RS256 emitido pela Identidade. A Adoção só conhece a chave
// PÚBLICA: confere assinatura, emissor e expiração, e lê o sub e a role. É a 3ª camada da
// autorização (o gateway valida o token, o BFF confere a role do cliente e o serviço
// decide sobre o recurso).
package auth

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const Emissor = "ampara-identidade"

type Usuario struct {
	Sub  string
	Role string
}

type Verificador struct{ chave *rsa.PublicKey }

// NovoVerificador aceita o PEM com quebras de linha reais ou escapadas como \n.
func NovoVerificador(pemPublico string) (*Verificador, error) {
	chave, err := jwt.ParseRSAPublicKeyFromPEM([]byte(strings.ReplaceAll(pemPublico, `\n`, "\n")))
	if err != nil {
		return nil, fmt.Errorf("JWT_PUBLIC_KEY inválida: %w", err)
	}
	return &Verificador{chave: chave}, nil
}

type claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func (v *Verificador) Verificar(token string) (Usuario, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return v.chave, nil },
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(Emissor),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return Usuario{}, err
	}
	if c.Subject == "" || c.Role == "" {
		return Usuario{}, errors.New("token sem sub ou role")
	}
	return Usuario{Sub: c.Subject, Role: c.Role}, nil
}
