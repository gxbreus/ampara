// Package config lê a configuração do serviço só de variáveis de ambiente.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Porta        string
	DatabaseURL  string
	AMQPURL      string
	JWTPublicKey string
	TimeoutPasso time.Duration
	PrazoDecisao time.Duration
	MaxReenvios  int
}

func Carregar() (Config, error) {
	c := Config{
		Porta:       valorOuPadrao("ADOCAO_PORTA", "8080"),
		DatabaseURL: os.Getenv("ADOCAO_DATABASE_URL"),
		AMQPURL:     os.Getenv("ADOCAO_AMQP_URL"),
		// a Adoção só valida tokens; quem assina é a Identidade, com a chave privada
		JWTPublicKey: os.Getenv("JWT_PUBLIC_KEY"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("ADOCAO_DATABASE_URL não definida")
	}
	if c.AMQPURL == "" {
		return c, errors.New("ADOCAO_AMQP_URL não definida")
	}
	if c.JWTPublicKey == "" {
		return c, errors.New("JWT_PUBLIC_KEY não definida")
	}
	var err error
	if c.TimeoutPasso, err = duracao("ADOCAO_TIMEOUT_PASSO", "10s"); err != nil {
		return c, err
	}
	if c.PrazoDecisao, err = duracao("ADOCAO_PRAZO_EXPIRACAO", "72h"); err != nil {
		return c, err
	}
	if c.MaxReenvios, err = strconv.Atoi(valorOuPadrao("ADOCAO_MAX_REENVIOS_COMPENSACAO", "10")); err != nil {
		return c, fmt.Errorf("ADOCAO_MAX_REENVIOS_COMPENSACAO: %w", err)
	}
	return c, nil
}

func duracao(chave, padrao string) (time.Duration, error) {
	d, err := time.ParseDuration(valorOuPadrao(chave, padrao))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", chave, err)
	}
	return d, nil
}

func valorOuPadrao(chave, padrao string) string {
	if v := os.Getenv(chave); v != "" {
		return v
	}
	return padrao
}
